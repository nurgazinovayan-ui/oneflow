#!/usr/bin/env bash
# ONEFLOW — keeps every generation for its owner on the KZ server, so it shows up again after a
# reload and on any device ("Ассеты" and the Generation history).
#
#   sudo bash ~/oneflow-assets/assets-setup.sh
#
# 1. Checks (changes nothing): the user_assets table, the private user-generations bucket, the new
#    functions on this server, how many videos made before would show up in "Ассеты".
# 2. Shows the change and asks; only after «да» runs user_assets.sql in one transaction (creates
#    what is missing, lists the earlier videos; users, balances and files are not touched).
# 3. Checks from outside, through https://api.oneflow.art: a kept picture does not open without a
#    signed link and opens with one; the table cannot be read directly; the user-assets function
#    lets nobody in without signing in.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/oneflow/supabase}"
DOMAIN="${DOMAIN:-api.oneflow.art}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUCKET=user-generations

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*"; FAILS=$(( ${FAILS:-0} + 1 )); }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
info() { printf '    · %s\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

env_value() { local v; v=$(grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2-) || true; v=${v#\'}; printf '%s' "${v%\'}"; }

# psql as the database superuser inside the db container; the password goes by name (-e PGPASSWORD).
# db reads SQL from stdin (-i); q runs one query without touching stdin, so it can't swallow typed answers.
db() {
  PGPASSWORD=$(env_value "$APP_DIR/.env" POSTGRES_PASSWORD) \
    docker exec -i -e PGPASSWORD "$DB_CONTAINER" psql -U supabase_admin -h 127.0.0.1 -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
}
q() {
  PGPASSWORD=$(env_value "$APP_DIR/.env" POSTGRES_PASSWORD) \
    docker exec -e PGPASSWORD "$DB_CONTAINER" psql -U supabase_admin -h 127.0.0.1 -d postgres -X -q -v ON_ERROR_STOP=1 -At -c "$1"
}
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

[[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0"
[[ -f "$APP_DIR/.env" ]] || die "Нет $APP_DIR/.env — это не сервер ONEFLOW?"
(cd "$HERE" && sha256sum -c --quiet SHA256SUMS) || die "Пакет повреждён — скачайте oneflow-assets.tar.gz заново"

# the videos made before that the change would list (same rule as user_assets.sql)
EARLIER_VIDEOS="select count(*) from public.generation_reservations r
  cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r.result -> 'urls') = 'array' then r.result -> 'urls' else '[]'::jsonb end) as u(url)
  join storage.objects o on o.bucket_id = 'ai-generated-videos' and o.name = substring(u.url from '/object/public/ai-generated-videos/([^?]+)')
 where r.status = 'settled' and r.category = 'video'"

# ---------------------------------------------------------------------------------------------
check() {
  FAILS=0; MISSING=()
  step "База и хранилище"
  if [[ "$(q "select to_regclass('public.user_assets') is not null")" == t ]]; then
    ok "таблица user_assets: сохранено генераций — $(q "select count(*) from public.user_assets"), из них видео — $(q "select count(*) from public.user_assets where kind = 'video'")"
  else
    bad "нет таблицы user_assets — генерации не сохраняются за пользователем"; MISSING+=(table)
  fi
  local b; b=$(q "select public::text || ' ' || coalesce(file_size_limit::text, '-') || ' ' || coalesce(array_to_string(allowed_mime_types, ','), '-') from storage.buckets where id = '$BUCKET'")
  if [[ -z "$b" ]]; then
    bad "нет хранилища $BUCKET для картинок"; MISSING+=(bucket)
  elif [[ "$b" == "false 52428800 image/png,image/jpeg,image/webp" ]]; then
    ok "хранилище $BUCKET: закрытое (только по подписанной ссылке), до 50 МБ, PNG/JPEG/WebP, файлов — $(q "select count(*) from storage.objects where bucket_id = '$BUCKET'")"
  else
    bad "хранилище $BUCKET с другими настройками ($b) — user_assets.sql вернёт правильные"; MISSING+=(bucket)
  fi
  [[ " ${MISSING[*]} " == *" table "* ]] && info "видео, сделанных раньше, появится в «Ассетах»: $(q "$EARLIER_VIDEOS")"

  step "Функции на этом сервере"
  local fdir="$APP_DIR/volumes/functions"
  [[ -f "$fdir/user-assets/index.ts" ]] && ok "user-assets («Ассеты» и история генераций)" \
    || bad "нет функции user-assets — сначала install-functions.sh из нового пакета"
  local f
  for f in generate-image generate-video generate-video-pro; do
    grep -q '^// ---- User assets' "$fdir/$f/index.ts" 2>/dev/null && ok "$f сохраняет результат за пользователем" \
      || bad "$f — прежняя версия, результат не сохраняется (install-functions.sh из нового пакета)"
  done
}

# ---------------------------------------------------------------------------------------------
apply_sql() {
  step "Изменения в базе"
  cat <<EOF
    Будет выполнен user_assets.sql (одна транзакция). Он создаёт только то, чего нет:
      · таблицу user_assets: какая генерация чья (читают и пишут только функции сервера);
      · закрытое хранилище $BUCKET для картинок: до 50 МБ, PNG/JPEG/WebP, открываются
        только по подписанной ссылке, которую получает владелец;
      · в «Ассетах» появятся видео, сделанные раньше: $(q "$EARLIER_VIDEOS") (файлы уже на сервере).
    Пользователи, балансы, генерации и файлы не меняются.
    Откат (пока новые картинки не сохранялись):
      drop table public.user_assets; delete from storage.buckets where id = '$BUCKET';
EOF
  local answer
  read -r -p "    Применить? Введите «да»: " answer
  [[ "$answer" == да ]] || die "Ничего не изменено."
  local out
  out=$(db --single-transaction < "$HERE/user_assets.sql" 2>&1) || { grep -E 'ERROR|ОШИБКА' <<< "$out" | head -3 | sed 's/^/    /'; die "user_assets.sql не применился — изменения откатились. Пришлите скриншот."; }
  q "NOTIFY pgrst, 'reload schema'" >/dev/null
  ok "user_assets.sql применён"
}

# ---------------------------------------------------------------------------------------------
# From outside, through Caddy and the gateway, like the app and a stranger would.
outside_test() {
  step "Проверка снаружи"
  local srk anon tmp="$TMPD" path code body signed
  srk=$(env_value "$APP_DIR/.env" SERVICE_ROLE_KEY); anon=$(env_value "$APP_DIR/.env" ANON_KEY)
  # keys go to curl through a config on a pipe, never on the command line
  svc() { printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$srk" "$srk"; }
  pub() { printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$anon" "$anon"; }
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' | base64 -d > "$tmp/t.png"
  path="_check/$(cat /proc/sys/kernel/random/uuid).png"

  code=$(curl -s -m 30 -o "$tmp/up.txt" -w '%{http_code}' -K <(svc) -H 'Content-Type: image/png' --data-binary "@$tmp/t.png" "https://$DOMAIN/storage/v1/object/$BUCKET/$path" || true)
  if [[ "$code" != 200 ]]; then bad "пробная картинка не сохранилась: HTTP $code $(head -c 160 "$tmp/up.txt")"; else
    ok "картинка сохраняется в $BUCKET"
    code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' "https://$DOMAIN/storage/v1/object/public/$BUCKET/$path" || true)
    [[ "$code" != 200 ]] && ok "без подписанной ссылки не открывается (HTTP $code)" || bad "картинка открывается без подписи — хранилище не закрыто"
    code=$(curl -s -m 20 -o "$tmp/sign.json" -w '%{http_code}' -K <(svc) -H 'Content-Type: application/json' -d '{"expiresIn":60}' "https://$DOMAIN/storage/v1/object/sign/$BUCKET/$path" || true)
    signed=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1])).get("signedURL",""))' "$tmp/sign.json" 2>/dev/null || true)
    body=$(curl -s -m 20 -o /dev/null -w '%{http_code} %{content_type}' "https://$DOMAIN/storage/v1$signed" || true)
    [[ "$code" == 200 && "$body" == "200 image/png"* ]] && ok "по подписанной ссылке открывается (так её видит владелец)" || bad "подписанная ссылка: $code / $body"
    code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -K <(svc) -X DELETE "https://$DOMAIN/storage/v1/object/$BUCKET/$path" || true)
    [[ "$code" == 200 ]] && ok "пробная картинка удалена" || bad "пробная картинка не удалена (HTTP $code): $BUCKET/$path"
  fi

  body=$(curl -s -m 20 -K <(pub) "https://$DOMAIN/rest/v1/user_assets?select=id&limit=1" || true)
  [[ "$body" == "[]" || "$body" == *"permission denied"* || "$body" == *'"code":"42501"'* ]] \
    && ok "таблицу user_assets нельзя прочитать напрямую" || bad "таблица user_assets читается напрямую: $(head -c 120 <<< "$body")"
  code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"action":"list"}' "https://$DOMAIN/functions/v1/user-assets" || true)
  [[ "$code" == 401 ]] && ok "user-assets без входа не пускает (401)" || bad "user-assets без входа: HTTP $code"
}

check
if [[ ${#MISSING[@]} -gt 0 ]]; then
  apply_sql
  check
fi
outside_test
if [[ ${FAILS:-0} -gt 0 ]]; then
  die "Замечаний: $FAILS — пришлите скриншот (секретов на экране нет)."
fi
printf '\n\033[1;32mГотово: генерации сохраняются за пользователем.\033[0m Они видны в «Ассетах» и в истории генераций с любого устройства.\n'
