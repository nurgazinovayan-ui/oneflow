#!/usr/bin/env bash
# ONEFLOW — switching oneflow.art from the old Supabase project to the KZ server.
#
#   sudo bash ~/oneflow-switch/switch.sh precheck   is the server ready? (safe to run any time)
#   sudo bash ~/oneflow-switch/switch.sh finish     after the final migrate.sh: links, schedule,
#                                                   fresh backup, checks
#   sudo bash ~/oneflow-switch/switch.sh rollback   how to go back (prints steps, changes nothing)
#
# finish:
#   1. links to files of the old project stored in the data (messages, site texts, …) are
#      rewritten to https://api.oneflow.art — one transaction, counts per column, no row contents;
#   2. the daily trends refresh (was a pg_cron job of the old project, 03:00 UTC) becomes a
#      systemd timer calling trendswatch-refresh with x-cron-secret from functions.env;
#   3. a backup is taken right away (the first one of the live data);
#   4. checks: API, a public file through the new address, schedule, backup.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/oneflow/supabase}"
DOMAIN="${DOMAIN:-api.oneflow.art}"
SITE_ORIGIN="${SITE_ORIGIN:-https://oneflow.art}"
OLD_URL="${OLD_URL:-https://ayxmfihtrsacfdhszsri.supabase.co}"
NEW_URL="https://$DOMAIN"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*"; FAILS=$(( ${FAILS:-0} + 1 )); }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

env_value() { local v; v=$(grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2-) || true; v=${v#\'}; printf '%s' "${v%\'}"; }

# psql as the database superuser inside the db container; the password goes by name (-e PGPASSWORD)
db() {
  PGPASSWORD=$(env_value "$APP_DIR/.env" POSTGRES_PASSWORD) \
    docker exec -i -e PGPASSWORD "$DB_CONTAINER" psql -U supabase_admin -h 127.0.0.1 -d postgres -X -q -v ON_ERROR_STOP=1 "$@"
}

http_code() { curl -s -o /dev/null -m 20 -w '%{http_code}' "$@" || true; }

# ---------------------------------------------------------------------------------------------
precheck() {
  FAILS=0
  local anon settings code hdrs path
  anon=$(env_value "$APP_DIR/.env" ANON_KEY)

  step "Сервисы Supabase"
  local not_ok
  not_ok=$(docker ps -a --filter 'name=supabase' --format '{{.Names}}|{{.Status}}' | awk -F'|' '$2 !~ /^Up/ || $2 ~ /unhealthy/ {print $1 " (" $2 ")"}')
  [[ -z "$not_ok" ]] && ok "все контейнеры работают" || bad "не работают: $(tr '\n' ' ' <<< "$not_ok")"

  step "Адрес https://$DOMAIN"
  code=$(http_code -H "apikey: $anon" "$NEW_URL/auth/v1/health")
  [[ "$code" == 200 ]] && ok "вход (auth) отвечает" || bad "auth/v1/health → HTTP $code"
  code=$(http_code -H "apikey: $anon" "$NEW_URL/rest/v1/")
  [[ "$code" =~ ^(200|401|404)$ ]] && ok "база (rest) отвечает" || bad "rest/v1 → HTTP $code"

  step "Запросы с сайта $SITE_ORIGIN (CORS)"
  for path in "/auth/v1/token?grant_type=password" "/rest/v1/site_content" "/storage/v1/object/x/y" "/functions/v1/generate-image"; do
    hdrs=$(curl -s -o /dev/null -m 20 -D - -X OPTIONS -H "Origin: $SITE_ORIGIN" \
      -H 'Access-Control-Request-Method: POST' \
      -H 'Access-Control-Request-Headers: apikey,authorization,content-type,x-client-info' \
      "$NEW_URL$path" | tr -d '\r' || true)
    code=$(awk 'NR == 1 {print $2}' <<< "$hdrs")
    if [[ "$code" =~ ^(200|204)$ ]] && grep -qiE "^access-control-allow-origin: *(\*|$SITE_ORIGIN)" <<< "$hdrs"; then
      ok "${path%%\?*}"
    else
      bad "${path%%\?*} → HTTP ${code:-нет ответа}, разрешения для $SITE_ORIGIN нет"
    fi
  done

  step "Вход и почта"
  settings=$(curl -fsS -m 20 -H "apikey: $anon" "$NEW_URL/auth/v1/settings" || echo '{}')
  python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("external", {}).get("google") else 1)' <<< "$settings" \
    && ok "вход через Google включён" || bad "вход через Google выключен (configure-auth.sh)"
  python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin).get("external", {}).get("email") else 1)' <<< "$settings" \
    && ok "вход по email включён" || bad "вход по email выключен"
  local smtp; smtp=$(env_value "$APP_DIR/.env" SMTP_HOST)
  [[ -n "$smtp" && "$smtp" != supabase-mail ]] && ok "почта: $smtp" || bad "почта (SMTP) не настроена (configure-auth.sh)"

  step "Функции"
  local key
  for key in CRON_SECRET LEMONSQUEEZY_WEBHOOK_SECRET OPENROUTER_API_KEY; do
    [[ -n "$(env_value "$APP_DIR/functions.env" "$key")" ]] && ok "$key задан" || bad "$key не задан (install-functions.sh)"
  done
  code=$(http_code -X POST "$NEW_URL/functions/v1/lemonsqueezy-webhook")
  [[ "$code" =~ ^(400|401|403)$ ]] && ok "вебхук оплаты отвечает и без подписи не принимает (HTTP $code)" \
    || bad "вебхук оплаты → HTTP $code"

  step "Резервные копии"
  if [[ -r /var/lib/oneflow-backup/last-ok ]]; then
    local age=$(( $(date +%s) - $(stat -c %Y /var/lib/oneflow-backup/last-ok) ))
    (( age < 36 * 3600 )) && ok "последняя копия $(( age / 3600 )) ч назад" || bad "последняя копия старше 36 ч"
  else
    bad "копий ещё не было (install-backup.sh)"
  fi
  systemctl is-active --quiet oneflow-backup.timer && ok "ночное копирование включено" || bad "таймер копирования выключен"

  step "Место на диске"
  local free; free=$(df -Pm "$APP_DIR" | awk 'NR == 2 {print $4}')
  (( free > 5000 )) && ok "свободно $(( free / 1024 )) ГБ" || bad "свободно меньше 5 ГБ"

  echo
  if (( FAILS == 0 )); then
    printf '\033[1;32mГотово к переключению.\033[0m\n'
  else
    printf '\033[1;31mНе готово: %s пункт(ов) с ✗ — пришлите скриншот.\033[0m\n' "$FAILS"
    exit 1
  fi
}

# ---------------------------------------------------------------------------------------------
rewrite_links() {
  step "1/4 Ссылки на файлы старого проекта → $NEW_URL"
  # every text-like column of the app tables (public schema); generated columns are skipped,
  # triggers stay off (replica) so nothing else reacts to the rewrite; one transaction
  local out
  out=$(db -v old="$OLD_URL" -v new="$NEW_URL" 2>&1 <<'SQL'
BEGIN;
SET LOCAL session_replication_role = replica;
SELECT set_config('oneflow.old', :'old', true), set_config('oneflow.new', :'new', true);
DO $$
DECLARE
  r record; n bigint; total bigint := 0;
  o text := current_setting('oneflow.old'); w text := current_setting('oneflow.new');
  cast_to text;
BEGIN
  FOR r IN
    SELECT c.table_name t, c.column_name col, c.data_type dt, c.udt_name udt
    FROM information_schema.columns c
    JOIN information_schema.tables tb
      ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public' AND c.is_generated = 'NEVER'
      AND (c.data_type IN ('text', 'character varying', 'jsonb', 'json')
           OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar')))
    ORDER BY 1, 2
  LOOP
    cast_to := CASE WHEN r.dt = 'ARRAY' THEN 'text[]' WHEN r.dt IN ('jsonb', 'json') THEN r.dt ELSE NULL END;
    IF cast_to IS NULL THEN
      EXECUTE format('UPDATE public.%I SET %I = replace(%I, $1, $2) WHERE strpos(%I, $1) > 0', r.t, r.col, r.col, r.col)
        USING o, w;
    ELSE
      EXECUTE format('UPDATE public.%I SET %I = replace(%I::text, $1, $2)::%s WHERE strpos(%I::text, $1) > 0',
                     r.t, r.col, r.col, cast_to, r.col) USING o, w;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'oneflow-rewrite %.%: %', r.t, r.col, n;
      total := total + n;
    END IF;
  END LOOP;
  RAISE NOTICE 'oneflow-rewrite-total %', total;
END $$;
COMMIT;
SQL
) || { grep -E 'ERROR|ОШИБКА' <<< "$out" | head -3 | sed 's/^/    /'; die "Замена ссылок не прошла — ничего не изменено. Пришлите скриншот."; }
  grep -oE 'oneflow-rewrite [^ ]+: [0-9]+' <<< "$out" | sed -E 's/oneflow-rewrite /    /; s/: ([0-9]+)$/ — строк: \1/' || true
  ok "Заменено строк: $(grep -oE 'oneflow-rewrite-total [0-9]+' <<< "$out" | awk '{print $2}')"
  # whatever is left anywhere in the app tables (each row as text, so every column type counts)
  local left
  left=$(db -At -v old="$OLD_URL" 2>&1 <<'SQL'
SELECT set_config('oneflow.old', :'old', false);
DO $$
DECLARE r record; n bigint; total bigint := 0;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1 LOOP
    EXECUTE format('SELECT count(*) FROM public.%I x WHERE strpos(x::text, $1) > 0', r.tablename)
      INTO n USING current_setting('oneflow.old');
    IF n > 0 THEN RAISE NOTICE 'oneflow-left %: %', r.tablename, n; END IF;
    total := total + n;
  END LOOP;
  RAISE NOTICE 'oneflow-left-total %', total;
END $$;
SQL
  ) || true
  local total; total=$(grep -oE 'oneflow-left-total [0-9]+' <<< "$left" | awk '{print $2}')
  if [[ "$total" == 0 ]]; then
    ok "старого адреса в данных не осталось"
  else
    warn "старый адрес ещё встречается (${total:-?}): $(grep -oE 'oneflow-left [^ ]+: [0-9]+' <<< "$left" | sed 's/oneflow-left //' | tr '\n' ' ')"
  fi
}

install_trends_timer() {
  step "2/4 Ежедневное обновление трендов (03:00 UTC = 08:00 Астана)"
  cat > /usr/local/sbin/oneflow-trendswatch <<'EOF'
#!/usr/bin/env bash
# ONEFLOW — daily trends refresh (systemd timer oneflow-trendswatch.timer).
# The secret goes to curl through a config file descriptor, never on a command line.
set -euo pipefail
FENV=/opt/oneflow/supabase/functions.env
val() { local v; v=$(grep -E "^$1=" "$FENV" | tail -n1 | cut -d= -f2-); v=${v#\'}; printf '%s' "${v%\'}"; }
secret=$(val CRON_SECRET)
[[ -n "$secret" ]] || { echo "CRON_SECRET не задан в $FENV" >&2; exit 1; }
code=$(curl -s -o /tmp/oneflow-trendswatch.out -m 900 -w '%{http_code}' -X POST \
  -K <(printf 'header = "x-cron-secret: %s"\n' "$secret") \
  -H 'Content-Type: application/json' --data '{}' \
  https://api.oneflow.art/functions/v1/trendswatch-refresh) || code=000
echo "trendswatch-refresh: HTTP $code $(head -c 300 /tmp/oneflow-trendswatch.out 2>/dev/null)"
rm -f /tmp/oneflow-trendswatch.out
if [[ "$code" != 200 ]]; then
  url=$(val ALERT_WEBHOOK_URL)
  if [[ "$url" == https://* ]]; then
    curl -fsS -m 15 -K <(printf 'url = "%s"\n' "$url") -H 'Content-Type: application/json' \
      --data "{\"text\": \"ONEFLOW trends refresh failed: HTTP $code\"}" >/dev/null 2>&1 || true
  fi
  exit 1
fi
EOF
  chmod 755 /usr/local/sbin/oneflow-trendswatch
  cat > /etc/systemd/system/oneflow-trendswatch.service <<'EOF'
[Unit]
Description=ONEFLOW daily trends refresh
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/oneflow-trendswatch
EOF
  cat > /etc/systemd/system/oneflow-trendswatch.timer <<'EOF'
[Unit]
Description=ONEFLOW daily trends refresh at 03:00 UTC (the old project's pg_cron "0 3 * * *")

[Timer]
OnCalendar=*-*-* 03:00:00 UTC
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now oneflow-trendswatch.timer >/dev/null 2>&1
  ok "Расписание включено: $(systemctl list-timers oneflow-trendswatch.timer --no-pager | awk 'NR == 2 {print $1, $2, $3, $4}')"
}

backup_now() {
  step "3/4 Резервная копия рабочих данных"
  if command -v oneflow-backup >/dev/null; then
    oneflow-backup run | sed 's/^/    /' || bad "копия не получилась — пришлите скриншот"
  else
    bad "oneflow-backup не установлен (install-backup.sh)"
  fi
}

final_checks() {
  step "4/4 Проверки"
  local anon code obj
  anon=$(env_value "$APP_DIR/.env" ANON_KEY)
  code=$(http_code -H "apikey: $anon" "$NEW_URL/auth/v1/health")
  [[ "$code" == 200 ]] && ok "вход отвечает" || bad "auth/v1/health → HTTP $code"
  # one file of a public bucket, fetched through the public address (name not printed)
  obj=$(db -At <<'SQL'
SELECT o.bucket_id || '/' || o.name FROM storage.objects o JOIN storage.buckets b ON b.id = o.bucket_id
WHERE b.public ORDER BY o.created_at DESC LIMIT 1;
SQL
  ) || obj=""
  if [[ -n "$obj" ]]; then
    local path; path=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe="/"))' "$obj")
    code=$(http_code -r 0-0 "$NEW_URL/storage/v1/object/public/$path")
    [[ "$code" =~ ^(200|206)$ ]] && ok "публичный файл открывается по новому адресу (бакет ${obj%%/*})" \
      || bad "публичный файл по новому адресу → HTTP $code"
  else
    warn "публичных файлов нет — проверка файлов пропущена"
  fi
  systemctl is-active --quiet oneflow-trendswatch.timer && ok "расписание трендов активно" || bad "расписание трендов не активно"
}

finish() {
  FAILS=0
  [[ -f "$APP_DIR/.env" ]] || die "Не найден $APP_DIR/.env"
  local users; users=$(db -At -c "select count(*) from auth.users") || die "База не отвечает"
  (( users > 0 )) || die "В базе нет пользователей — сначала перенос: migrate.sh --reset, затем migrate.sh"
  echo "    Пользователей в базе: $users"
  rewrite_links
  install_trends_timer
  backup_now
  final_checks
  echo
  if (( FAILS > 0 )); then
    printf '\033[1;31mЕсть пункты с ✗ (%s) — пришлите скриншот, сайт пока не переключайте.\033[0m\n' "$FAILS"
    exit 1
  fi
  printf '\033[1;32mСервер готов.\033[0m Дальше — по инструкции: сайт v18 в Vercel, адрес вебхука в LemonSqueezy.\n'
  echo
  echo "    Вебхук LemonSqueezy (Settings → Webhooks → ваш вебхук → Callback URL):"
  echo "      $NEW_URL/functions/v1/lemonsqueezy-webhook"
  echo "    Signing secret не меняйте: он совпадает с тем, что введён в install-functions.sh."
}

rollback() {
  cat <<EOF

Откат на старый Supabase (в первые часы после переключения):
  1. Vercel → проект oneflow.art → Deployments → прежняя версия сайта (v17) → «Promote to Production»
     (или загрузите oneflow-art-site-v17.zip так же, как обычно).
  2. LemonSqueezy → Webhooks → Callback URL снова на старый адрес:
       $OLD_URL/functions/v1/lemonsqueezy-webhook
  3. Сервер в Казахстане ничего не удаляет и продолжает работать — к нему можно вернуться позже.
Важно: регистрации, генерации и оплаты, сделанные после переключения, остались на новом сервере;
в старом проекте их не будет. Поэтому решение об откате — в первые часы.
EOF
}

main() {
  [[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0 ${1:-precheck}"
  case "${1:-}" in
    precheck) precheck ;;
    finish) finish ;;
    rollback) rollback ;;
    *) sed -n '2,8p' "$0"; exit 1 ;;
  esac
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
