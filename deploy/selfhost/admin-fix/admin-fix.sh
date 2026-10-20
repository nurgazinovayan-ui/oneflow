#!/usr/bin/env bash
# ONEFLOW — what the admin panel needs on the KZ server: the 'site-media' bucket (banner and news files),
# the site_content / support_tickets tables (admin.sql). admin.sql was run by hand in the old Supabase
# project, and the bucket was added to it later: a project that never re-ran it has no bucket, and the
# migration copied exactly what was there. Then every banner upload in /admin ends in an error.
#
#   sudo bash ~/oneflow-admin-fix/admin-fix.sh
#
# 1. Checks (changes nothing): tables, bucket, the admin functions on this server.
# 2. Shows what is missing and asks; only after «да» runs admin.sql in one transaction (it only
#    creates what is missing; existing rows, files and settings stay).
# 3. Checks a banner upload the way /admin does it, through https://api.oneflow.art: one-time upload
#    link, upload, public link, removal (a 1×1 test picture, removed at once).

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/oneflow/supabase}"
DOMAIN="${DOMAIN:-api.oneflow.art}"
SITE_ORIGIN="${SITE_ORIGIN:-https://oneflow.art}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUCKET=site-media

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*"; FAILS=$(( ${FAILS:-0} + 1 )); }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
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
(cd "$HERE" && sha256sum -c --quiet SHA256SUMS) || die "Пакет повреждён — скачайте oneflow-admin-fix.tar.gz заново"

# ---------------------------------------------------------------------------------------------
check() {
  FAILS=0; MISSING=()
  step "Таблицы и хранилище админки"
  if [[ "$(q "select to_regclass('public.site_content') is not null")" == t ]]; then
    local cols; cols=$(q "select string_agg(column_name, ',' order by column_name) from information_schema.columns where table_schema = 'public' and table_name = 'site_content'")
    [[ ",$cols," == *",updated_by,"* ]] && ok "site_content (тексты сайта, баннеры, новинки)" || { bad "в site_content нет колонки updated_by"; MISSING+=(site_content); }
  else
    bad "нет таблицы site_content"; MISSING+=(site_content)
  fi
  [[ "$(q "select to_regclass('public.support_tickets') is not null")" == t ]] && ok "support_tickets (обращения в поддержку)" \
    || { bad "нет таблицы support_tickets"; MISSING+=(support_tickets); }
  local b; b=$(q "select public::text || ' ' || coalesce(file_size_limit::text, '-') || ' ' || coalesce(array_to_string(allowed_mime_types, ','), '-') from storage.buckets where id = '$BUCKET'")
  if [[ -z "$b" ]]; then
    bad "нет хранилища $BUCKET — поэтому загрузка баннеров и новинок заканчивается ошибкой"; MISSING+=(bucket)
  elif [[ "$b" == true\ 52428800\ * ]]; then
    ok "хранилище $BUCKET: публичное, до 50 МБ, $(q "select count(*) from storage.objects where bucket_id = '$BUCKET'") файлов"
  else
    warn "хранилище $BUCKET есть, но настройки другие ($b) — admin.sql вернёт правильные"; MISSING+=(bucket-settings)
  fi
  local row
  for row in app.home.banners landing.news; do
    if [[ "$(q "select count(*) from public.site_content where key = '$row'" 2>/dev/null)" == 1 ]]; then
      ok "сохранено в админке: $row"
    else
      echo "    · $row: своих ещё нет (показываются стандартные)"
    fi
  done

  step "Функции админки на этом сервере"
  local fdir="$APP_DIR/volumes/functions"
  [[ -f "$fdir/support-submit/index.ts" ]] && ok "support-submit (форма «Написать в поддержку» на сайте)" \
    || bad "нет функции support-submit — форма поддержки на сайте не работает (сначала install-functions.sh из нового пакета)"
  grep -q 'admin-fix.sh' "$fdir/admin-api/index.ts" 2>/dev/null && ok "admin-api — новая версия (понятные ошибки загрузки)" \
    || warn "admin-api — прежняя версия"
  grep -q "'support-submit'" "$fdir/main/index.ts" 2>/dev/null && ok "роутер пускает форму поддержки без входа" \
    || bad "роутер требует вход для support-submit"
}

# ---------------------------------------------------------------------------------------------
apply_sql() {
  step "Изменения в базе"
  cat <<EOF
    Будет выполнен admin.sql (одна транзакция). Он создаёт только то, чего нет:
      · таблицы site_content и support_tickets (если их нет; данные не трогает);
      · правило «тексты сайта может читать любой» для site_content (пересоздаётся);
      · публичное хранилище $BUCKET: до 50 МБ, только JPG/PNG/WebP/GIF/MP4/WebM, без списка файлов.
    Пользователи, балансы, генерации и файлы не меняются.
    Откат (если понадобится и хранилище ещё пустое):
      delete from storage.buckets where id = '$BUCKET';
EOF
  local answer
  read -r -p "    Применить? Введите «да»: " answer
  [[ "$answer" == да ]] || die "Ничего не изменено."
  local out
  out=$(db --single-transaction < "$HERE/admin.sql" 2>&1) || { grep -E 'ERROR|ОШИБКА' <<< "$out" | head -3 | sed 's/^/    /'; die "admin.sql не применился — изменения откатились. Пришлите скриншот."; }
  q "NOTIFY pgrst, 'reload schema'" >/dev/null
  ok "admin.sql применён"
}

# ---------------------------------------------------------------------------------------------
# The upload /admin makes, step by step, through Caddy and the gateway like the browser does.
upload_test() {
  step "Проверка загрузки баннера (как в админке)"
  local srk anon tmp="$TMPD" path code body url
  srk=$(env_value "$APP_DIR/.env" SERVICE_ROLE_KEY); anon=$(env_value "$APP_DIR/.env" ANON_KEY)
  # 1×1 transparent PNG
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' | base64 -d > "$tmp/t.png"
  path="home-banners/$(cat /proc/sys/kernel/random/uuid).png"
  # keys go to curl through a config on a pipe, never on the command line
  svc() { printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$srk" "$srk"; }

  code=$(curl -s -m 30 -o "$tmp/sign.json" -w '%{http_code}' -K <(svc) -X POST "https://$DOMAIN/storage/v1/object/upload/sign/$BUCKET/$path" || true)
  if [[ "$code" != 200 ]]; then bad "ссылка для загрузки: HTTP $code $(head -c 160 "$tmp/sign.json")"; return; fi
  url=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["url"])' "$tmp/sign.json" 2>/dev/null || true)
  [[ "$url" == /object/upload/sign/* ]] || { bad "ссылка для загрузки: неожиданный ответ"; return; }
  ok "одноразовая ссылка для загрузки выдана"

  code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -X OPTIONS -H "Origin: $SITE_ORIGIN" -H 'Access-Control-Request-Method: PUT' \
    -H 'Access-Control-Request-Headers: apikey,authorization,x-upsert' "https://$DOMAIN/storage/v1$url" || true)
  [[ "$code" =~ ^20[04]$ ]] && ok "браузер может загружать с $SITE_ORIGIN (CORS: $code)" || bad "CORS для загрузки: HTTP $code"

  code=$(curl -s -m 60 -o "$tmp/put.txt" -w '%{http_code}' -X PUT -H "apikey: $anon" -H 'x-upsert: false' -H "Origin: $SITE_ORIGIN" \
    -F cacheControl=31536000 -F "file=@$tmp/t.png;type=image/png" "https://$DOMAIN/storage/v1$url" || true)
  [[ "$code" == 200 ]] && ok "файл загружен" || { bad "загрузка: HTTP $code $(head -c 160 "$tmp/put.txt")"; return; }

  body=$(curl -s -m 20 -o /dev/null -w '%{http_code} %{content_type}' "https://$DOMAIN/storage/v1/object/public/$BUCKET/$path" || true)
  [[ "$body" == "200 image/png"* ]] && ok "файл открывается по публичной ссылке (как в приложении)" || bad "публичная ссылка: $body"

  code=$(curl -s -m 20 -o /dev/null -w '%{http_code}' -K <(svc) -X DELETE "https://$DOMAIN/storage/v1/object/$BUCKET/$path" || true)
  [[ "$code" == 200 ]] && ok "пробный файл удалён" || bad "пробный файл не удалён (HTTP $code): $BUCKET/$path"
}

check
if [[ " ${MISSING[*]} " == *" bucket"* || " ${MISSING[*]} " == *" site_content "* || " ${MISSING[*]} " == *" support_tickets "* ]]; then
  apply_sql
  check
fi
upload_test
if [[ ${FAILS:-0} -gt 0 ]]; then
  die "Замечаний: $FAILS — пришлите скриншот (секретов на экране нет)."
fi
printf '\n\033[1;32mГотово: баннеры и новинки в админке загружаются.\033[0m Обновите страницу oneflow.art/admin.\n'
