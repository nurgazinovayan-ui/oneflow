#!/usr/bin/env bash
# ONEFLOW — перенос базы, пользователей и файлов со старого Supabase на этот сервер.
#
#   sudo bash ~/oneflow-migrate/migrate.sh           перенос (репетиция или настоящий)
#   sudo bash ~/oneflow-migrate/migrate.sh --reset   очистить базу и файлы НА ЭТОМ сервере
#                                                    (перед повторной репетицией)
#
# Старый проект только читается — в нём ничего не меняется, сайт продолжает работать на нём.
#
# Шаги:
#   1. инструменты: psql и Supabase CLI (версия закреплена, контрольная сумма проверяется);
#   2. вопросы: строка Session pooler, пароль базы, service_role ключ (ввод скрыт);
#   3. проверки: доступ к старой базе и хранилищу, новая база пустая, место на диске;
#   4. выгрузка роли/схема/данные (supabase db dump, как в официальной инструкции);
#   5. подгонка данных под версию Supabase на этом сервере (tools/fix_data.py);
#   6. загрузка ОДНОЙ транзакцией — при любой ошибке на новом сервере ничего не меняется;
#   7. свои триггеры и правила доступа в auth/storage — их официальная выгрузка пропускает
#      (tools/managed_extras.py); вебхуки на старый адрес выключаются, расписания — в отчёт;
#   8. обновления базы из репозитория: только недостающие + миграция защиты (sql/*.sql);
#   9. копирование файлов хранилища с сохранением владельцев (tools/copy_storage.py);
#  10. сверка «старый / новый» (tools/verify.py);
#  затем выгрузки с персональными данными удаляются; отчёты (без данных пользователей)
#  остаются в /root/oneflow-migrate-reports.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/oneflow/supabase}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPORTS=/root/oneflow-migrate-reports
STAMP="$(date +%Y%m%d-%H%M%S)"
CLI_VERSION=2.121.0
declare -A CLI_SHA256=(
  [amd64]=4b481189efbdc57cf2d37bdee5f1a0d29574314398564b32a6dfb76c0fcf275f
  [arm64]=896278173cd7c3632e9340e546129606a26e696e90bcaaa6f7b7490fe218efc7
)
WORK="/root/oneflow-migrate-work-$STAMP"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

get_env() { grep -E "^$1=" "${2:-$APP_DIR/.env}" 2>/dev/null | tail -n1 | cut -d= -f2- || true; }
clean() { local v=${1//$'\r'/}; v="${v#"${v%%[![:space:]]*}"}"; printf '%s' "${v%"${v##*[![:space:]]}"}"; }

# Passwords never go on a command line (any process on the server could read it there): psql,
# the Supabase CLI and the tools find them in $WORK/.pgpass (600, removed on any exit).
pgpass_add() {  # host user password
  local pw=${3//\\/\\\\}; pw=${pw//:/\\:}
  printf '%s:5432:postgres:%s:%s\n' "$1" "$2" "$pw" >> "$PGPASSFILE"
}

setup_new_db() {
  local user; user="postgres.$(get_env POOLER_TENANT_ID)"
  pgpass_add 127.0.0.1 "$user" "$(get_env POSTGRES_PASSWORD)"
  NEW_DB_URL="postgresql://${user}@127.0.0.1:5432/postgres?sslmode=disable"
}

wait_api() {
  local anon _; anon=$(get_env ANON_KEY)
  for _ in $(seq 1 90); do
    curl -fsS -o /dev/null -H "apikey: $anon" http://127.0.0.1:8000/auth/v1/health 2>/dev/null && return 0
    sleep 5
  done
  return 1
}

# ---------------------------------------------------------------------------------------------
reset_here() {
  step "Очистка базы и файлов НА ЭТОМ сервере"
  echo "    Будут удалены база и файлы на этом сервере ($APP_DIR/volumes/db/data и volumes/storage)."
  echo "    Старый Supabase и рабочий сайт это не затрагивает. Пароли и ключи сохранятся."
  local answer
  read -r -p "    Чтобы продолжить, введите слово ОЧИСТИТЬ: " answer
  [[ "$(clean "$answer")" == "ОЧИСТИТЬ" ]] || die "Отменено, ничего не удалено"
  cd "$APP_DIR"
  docker compose down >/dev/null 2>&1
  rm -rf "${APP_DIR:?}/volumes/db/data" "${APP_DIR:?}/volumes/storage" /root/oneflow-migrate-work-*
  mkdir -p "$APP_DIR/volumes/storage"
  docker compose up -d >/dev/null 2>&1
  wait_api || die "Supabase не поднялся после очистки. Пришлите вывод: cd $APP_DIR && sudo docker compose ps"
  ok "Чистая база готова. Теперь запустите перенос: sudo bash $HERE/migrate.sh"
}

install_tools() {
  step "1/10 Инструменты"
  if ! command -v psql >/dev/null; then
    apt-get update -qq && apt-get install -y -qq postgresql-client >/dev/null
  fi
  ok "psql $(psql --version | awk '{print $3}')"
  if [[ "$(supabase --version 2>/dev/null | tail -n1)" != "$CLI_VERSION" ]]; then
    local arch tmp; arch=$(dpkg --print-architecture)
    [[ -n "${CLI_SHA256[$arch]:-}" ]] || die "Неизвестная архитектура: $arch"
    tmp=$(mktemp -d)
    curl -fsSL -o "$tmp/cli.tgz" \
      "https://github.com/supabase/cli/releases/download/v${CLI_VERSION}/supabase_${CLI_VERSION}_linux_${arch}.tar.gz"
    echo "${CLI_SHA256[$arch]}  $tmp/cli.tgz" | sha256sum -c --quiet - \
      || die "Контрольная сумма Supabase CLI не совпала — файл не установлен"
    tar -xzf "$tmp/cli.tgz" -C "$tmp" supabase
    install -m 755 "$tmp/supabase" /usr/local/bin/supabase
    rm -rf "$tmp"
  fi
  ok "Supabase CLI $(supabase --version 2>/dev/null | tail -n1) (контрольная сумма проверена)"
}

ask_inputs() {
  step "2/10 Доступ к старому Supabase (вводится только сюда, никуда не отправляется)"
  echo "    1) Строка Session pooler из кнопки Connect: postgresql://postgres.…:[YOUR-PASSWORD]@…pooler.supabase.com:5432/postgres"
  local uri pw key
  local re='^postgres(ql)?://postgres\.([a-z0-9]{20})(:([^@]*))?@([a-z0-9.-]+\.pooler\.supabase\.com):5432/postgres(\?.*)?$'
  while true; do
    read -r -p "    Вставьте строку и нажмите Enter: " uri || die "Ввод прерван"; uri=$(clean "$uri")
    if [[ "$uri" =~ $re ]]; then
      OLD_REF=${BASH_REMATCH[2]}; OLD_HOST=${BASH_REMATCH[5]}; pw=${BASH_REMATCH[4]}; break
    fi
    if [[ "$uri" == *"db."*".supabase.co"* ]]; then warn "Это Direct connection (только IPv6). Выберите Session pooler."; continue; fi
    if [[ "$uri" == *".pooler.supabase.com:6543"* ]]; then warn "Это Transaction pooler (порт 6543). Выберите Session pooler (порт 5432)."; continue; fi
    warn "Не похоже на строку Session pooler (порт 5432, адрес …pooler.supabase.com). Скопируйте ещё раз."
  done
  if [[ -n "$pw" && "$pw" != "[YOUR-PASSWORD]" ]]; then
    # the password came inside the string, URL-encoded
    warn "В строке уже был пароль — после переноса очистите экран командой clear"
    pw=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.unquote(sys.stdin.read().rstrip("\n")))' <<< "$pw")
  else
    while true; do
      read -r -s -p "    2) Пароль базы старого проекта (ввод скрыт): " pw || die "Ввод прерван"; echo; pw=$(clean "$pw")
      [[ -n "$pw" ]] && break
    done
  fi
  pgpass_add "$OLD_HOST" "postgres.${OLD_REF}" "$pw"
  OLD_DB_URL="postgresql://postgres.${OLD_REF}@${OLD_HOST}:5432/postgres?sslmode=require"
  while true; do
    read -r -s -p "    3) service_role ключ старого проекта (Project Settings → API Keys → Legacy, ввод скрыт): " key || die "Ввод прерван"; echo
    key=$(clean "$key")
    [[ "$key" =~ ^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$ ]] && break
    warn "Не похоже на service_role ключ (длинная строка, начинается с eyJ). Скопируйте ещё раз."
  done
  OLD_URL="https://${OLD_REF}.supabase.co"
  OLD_KEY=$key
  ok "Проект: $OLD_REF"
}

preflight() {
  step "3/10 Проверки"
  local out
  out=$(psql "$OLD_DB_URL" -X -At -c "select current_setting('server_version_num')" 2>&1) \
    || die "Не удалось подключиться к старой базе: $(tail -n1 <<<"$out" | sed -E 's#postgres(ql)?://[^ ]+#<строка>#g'). Проверьте пароль (его можно сбросить в Connect → Reset database password)."
  ok "Старая база доступна (PostgreSQL ${out:0:2})"
  local code
  # the key goes to curl through stdin, not the command line
  code=$(curl -s -o /dev/null -w '%{http_code}' -K - "$OLD_URL/storage/v1/bucket" <<EOF
header = "Authorization: Bearer $OLD_KEY"
header = "apikey: $OLD_KEY"
EOF
)
  [[ "$code" == 200 ]] || die "Хранилище старого проекта не принимает service_role ключ (HTTP $code). Скопируйте ключ ещё раз."
  ok "Хранилище старого проекта доступно"

  setup_new_db
  out=$(psql "$NEW_DB_URL" -X -At -c "select (select count(*) from auth.users) + (select count(*) from pg_tables where schemaname = 'public')" 2>&1) \
    || die "Не удалось подключиться к базе на этом сервере: $(tail -n1 <<<"$out")"
  [[ "$out" == 0 ]] || die "База на этом сервере уже не пустая (видимо, прошлая репетиция). Сначала очистите её: sudo bash $HERE/migrate.sh --reset"
  ok "База на этом сервере пустая"

  local need_mb free_mb
  need_mb=$(psql "$OLD_DB_URL" -X -At -c "select (pg_database_size(current_database()) + coalesce((select sum((metadata->>'size')::bigint) from storage.objects), 0)) / 1000000 * 3")
  free_mb=$(df -Pm /root | awk 'NR == 2 {print $4}')
  (( free_mb > need_mb )) || die "Мало места на диске: нужно ~${need_mb} МБ, свободно ${free_mb} МБ"
  ok "Места на диске достаточно (нужно ~${need_mb} МБ, свободно ${free_mb} МБ)"
}

dump_old() {
  step "4/10 Выгрузка старой базы (официальный способ Supabase; первый раз скачивается образ ~1 ГБ)"
  cd "$WORK"
  supabase --workdir "$WORK" db dump --db-url "$OLD_DB_URL" -f roles.sql --role-only >/dev/null
  ok "Роли"
  supabase --workdir "$WORK" db dump --db-url "$OLD_DB_URL" -f schema.sql >/dev/null
  ok "Схема ($(grep -c '^CREATE TABLE' schema.sql || true) таблиц, $(grep -ciE '^CREATE (OR REPLACE )?FUNCTION' schema.sql || true) функций)"
  supabase --workdir "$WORK" db dump --db-url "$OLD_DB_URL" -f data.sql --use-copy --data-only >/dev/null
  ok "Данные ($(du -h data.sql | cut -f1))"
}

prepare_data() {
  step "5/10 Подгонка данных под версию Supabase на этом сервере"
  psql "$NEW_DB_URL" -X -At -F $'\t' -c "
    select n.nspname || '.' || c.relname, string_agg(a.attname, ',' order by a.attnum)
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relkind in ('r', 'p') and n.nspname in ('auth', 'storage')
    group by 1
    union all
    select 'seq:' || n.nspname || '.' || c.relname, ''
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where c.relkind = 'S' and n.nspname in ('auth', 'storage')" > "$WORK/managed-columns.tsv"
  install -d -m 700 "$REPORTS"
  # extensions the old project had that this Postgres 17 does not ship (pgsodium, pgjwt… were
  # dropped in 17): CREATE EXTENSION for them would abort the whole restore, so it is commented out
  local ext avail
  avail=$(psql "$NEW_DB_URL" -X -At -c "select name from pg_available_extensions")
  while read -r ext; do
    [[ -n "$ext" ]] || continue
    grep -qxF "$ext" <<< "$avail" && continue
    sed -i -E "s/^CREATE EXTENSION IF NOT EXISTS \"$ext\"/-- &/" "$WORK/schema.sql"
    warn "Расширение $ext было в старом проекте, но его нет в Postgres 17 на этом сервере — пропущено" \
      | tee -a "$REPORTS/fix-data-$STAMP.txt"
  done < <(grep -oE '^CREATE EXTENSION IF NOT EXISTS "[^"]+"' "$WORK/schema.sql" | cut -d'"' -f2 | sort -u || true)
  python3 "$HERE/tools/fix_data.py" "$WORK/data.sql" "$WORK/managed-columns.tsv" "$WORK/data.fixed.sql" \
    | tee -a "$REPORTS/fix-data-$STAMP.txt"
}

restore_new() {
  step "6/10 Загрузка на этот сервер (одной транзакцией)"
  # psql output can quote rows (CONTEXT: COPY …), so it stays in WORK; reports get error lines only
  local log="$WORK/restore.log"
  if ! psql "$NEW_DB_URL" -X -q --single-transaction -v ON_ERROR_STOP=1 \
        --file "$WORK/roles.sql" --file "$WORK/schema.sql" \
        --command 'SET session_replication_role = replica' \
        --file "$WORK/data.fixed.sql" > "$log" 2>&1; then
    grep -E '(^|: )(ERROR|ОШИБКА):' "$log" | head -3 | cut -c1-200 | tee "$REPORTS/restore-error-$STAMP.txt" | sed 's/^/    /'
    die "Загрузка отменена, база на этом сервере не изменилась. Пришлите скриншот строк выше (данных пользователей в них нет)."
  fi
  ok "Роли, схема, пользователи и данные загружены"
}

managed_extras() {
  step "7/10 Триггеры и правила доступа из auth/storage (официальная выгрузка их пропускает)"
  OLD_DB_URL="$OLD_DB_URL" NEW_DB_URL="$NEW_DB_URL" python3 "$HERE/tools/managed_extras.py" \
    | tee "$REPORTS/extras-$STAMP.txt" \
    || warn "Часть правил или триггеров не создана — список выше (✗). Пришлите скриншот."
}

# file|marker: the marker is a SQL boolean that is true when the old project already had it.
# No marker = always applied (the security migration is written to be re-run safely).
MIGRATIONS='202609070001_trends.sql|to_regclass('"'"'public.trend_prompts'"'"') is not null
202609070002_trends_attribution.sql|exists (select 1 from information_schema.columns where table_schema = '"'"'public'"'"' and table_name = '"'"'trend_prompts'"'"' and column_name = '"'"'license'"'"')
202609070003_messenger.sql|to_regclass('"'"'public.messenger_channels'"'"') is not null
202609070004_messenger_media.sql|exists (select 1 from information_schema.columns where table_schema = '"'"'public'"'"' and table_name = '"'"'messenger_messages'"'"' and column_name = '"'"'kind'"'"')
202609090001_messenger_read_files.sql|exists (select 1 from information_schema.columns where table_schema = '"'"'public'"'"' and table_name = '"'"'messenger_members'"'"' and column_name = '"'"'last_read_at'"'"')
202609090002_ai_video_bucket.sql|exists (select 1 from storage.buckets where id = '"'"'ai-generated-videos'"'"')
202609240001_messenger_contacts.sql|to_regclass('"'"'public.messenger_invites'"'"') is not null
202609300001_storage_no_listing.sql|not exists (select 1 from pg_policies where schemaname = '"'"'storage'"'"' and tablename = '"'"'objects'"'"' and policyname in ('"'"'Messenger files public read'"'"', '"'"'AI generated videos public read'"'"'))
202610010001_generation_guard.sql|to_regclass('"'"'public.generation_reservations'"'"') is not null
202610060001_credits.sql|to_regclass('"'"'public.credit_packs'"'"') is not null
202610070001_legal_consent.sql|to_regclass('"'"'public.legal_consents'"'"') is not null
202610090001_security_hardening.sql|'

apply_migrations() {
  step "8/10 Обновления базы из репозитория (только недостающие) и миграция защиты"
  local log="$REPORTS/migrations-$STAMP.txt" f marker
  : > "$log"
  while IFS='|' read -r f marker; do
    [[ -n "$f" ]] || continue
    [[ -f "$HERE/sql/$f" ]] || die "В пакете нет файла sql/$f — скачайте пакет заново"
    if [[ -n "$marker" && "$(psql "$NEW_DB_URL" -X -At -c "select $marker")" == t ]]; then
      echo "    = ${f%.sql} — уже было в старом проекте"
      continue
    fi
    echo "== $f" >> "$log"
    psql "$NEW_DB_URL" -X -q --single-transaction -v ON_ERROR_STOP=1 -f "$HERE/sql/$f" >> "$log" 2>&1 \
      || { grep -E '(^|: )(ERROR|ОШИБКА):' "$log" | tail -n 3 | cut -c1-200 | sed 's/^/    /'
           die "Обновление ${f%.sql} не применилось (оно откатилось, остальное на месте). Пришлите скриншот."; }
    ok "${f%.sql} — применено"
  done <<< "$MIGRATIONS"
  psql "$NEW_DB_URL" -X -q -c "NOTIFY pgrst, 'reload schema'" >/dev/null
  ok "Лимиты расходов, журнал кредитов, приватный бакет мессенджера — включены"
}

raise_upload_limit() {
  # upstream caps every upload at 50 MB; it must fit the largest existing file and every bucket's
  # own limit (ai-generated-videos allows 300 MB), otherwise copying and future uploads fail
  local need
  need=$(psql "$NEW_DB_URL" -X -At -c "select coalesce(max(file_size_limit), 0) from storage.buckets")
  need=$(awk -F'\t' -v m="$need" '$4+0 > m {m=$4+0} END{printf "%.0f", m}' "$WORK/objects.tsv")
  (( need > 52428800 )) || return 0
  need=$(( (need / 1048576 + 2) * 1048576 ))
  cat > "$APP_DIR/docker-compose.storage.yml" <<EOF
# ONEFLOW: largest file / bucket limit needs $(( need / 1048576 )) MiB (upstream default is 50 MiB)
services:
  storage:
    environment:
      FILE_SIZE_LIMIT: $need
EOF
  local cf; cf=$(get_env COMPOSE_FILE)
  [[ ":$cf:" == *":docker-compose.storage.yml:"* ]] || sed -i "s|^COMPOSE_FILE=.*|COMPOSE_FILE=$cf:docker-compose.storage.yml|" "$APP_DIR/.env"
  (cd "$APP_DIR" && docker compose up -d --no-deps storage >/dev/null 2>&1)
  wait_api || die "Хранилище не поднялось после смены лимита. Пришлите вывод: cd $APP_DIR && sudo docker compose ps"
  sleep 5
  warn "Лимит загрузки файла поднят до $(( need / 1048576 )) МБ"
}

copy_files() {
  step "9/10 Файлы хранилища"
  psql "$OLD_DB_URL" -X -At -F $'\t' -c "
    select bucket_id, name, coalesce(metadata->>'mimetype', ''), coalesce(metadata->>'size', ''),
           coalesce(metadata->>'cacheControl', '')
    from storage.objects where name is not null order by bucket_id, name" > "$WORK/objects.tsv"
  local count cols sets
  count=$(wc -l < "$WORK/objects.tsv")
  raise_upload_limit
  echo "    Файлов: $count"
  (( count > 0 )) || { ok "Файлов нет"; return 0; }
  # an upload by service_role rewrites owner/metadata of the row restored from the dump:
  # remember the original owners and put them back afterwards (policies can depend on them)
  cols=$(psql "$NEW_DB_URL" -X -At -c "select string_agg(column_name, ',' order by column_name)
    from information_schema.columns where table_schema = 'storage' and table_name = 'objects'
      and column_name in ('owner', 'owner_id', 'user_metadata', 'created_at')")
  psql "$NEW_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "set client_min_messages = warning;
    drop schema if exists oneflow_migrate cascade;
    create schema oneflow_migrate;
    create table oneflow_migrate.objects_before as select bucket_id, name, $cols from storage.objects" >/dev/null
  OLD_URL="$OLD_URL" OLD_KEY="$OLD_KEY" NEW_URL="http://127.0.0.1:8000" NEW_KEY="$(get_env SERVICE_ROLE_KEY)" \
    TMPDIR="$WORK" python3 "$HERE/tools/copy_storage.py" "$WORK/objects.tsv" | tee "$REPORTS/storage-$STAMP.txt" \
    || warn "Часть файлов не скопирована — список выше. Остальное перенесено."
  sets=$(sed -E 's/([a-z_]+)/\1 = b.\1/g' <<< "$cols")
  psql "$NEW_DB_URL" -X -q -v ON_ERROR_STOP=1 -c "set client_min_messages = warning;
    update storage.objects o set $sets
    from oneflow_migrate.objects_before b where b.bucket_id = o.bucket_id and b.name = o.name;
    drop schema oneflow_migrate cascade" >/dev/null
  ok "Файлы скопированы, владельцы файлов сохранены"
}

verify_all() {
  step "10/10 Сверка «старый / новый»"
  OLD_DB_URL="$OLD_DB_URL" NEW_DB_URL="$NEW_DB_URL" python3 "$HERE/tools/verify.py" | tee "$REPORTS/verify-$STAMP.txt" \
    || warn "Есть расхождения (✗). На репетиции это нормально для таблиц, куда пишут пользователи прямо сейчас."
}

cleanup() {
  rm -rf "${WORK:?}"
  ok "Выгрузки с персональными данными и файл паролей удалены. Отчёты: $REPORTS"
}

main() {
  [[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0"
  [[ -f "$APP_DIR/.env" ]] && grep -q '^# oneflow-configured' "$APP_DIR/.env" || die "Сначала выполните oneflow-install.sh"
  trap 'die "Ошибка в строке $LINENO. Пришлите скриншот этого окна (секретов на нём нет)."' ERR
  umask 077
  if [[ "${1:-}" == "--reset" ]]; then reset_here; exit 0; fi
  # dumps (personal data) and the password file live here and are removed on ANY exit,
  # including errors and Ctrl+C
  install -d -m 700 "$WORK"
  trap 'rm -rf "${WORK:?}"' EXIT
  trap 'exit 130' INT TERM
  export PGPASSFILE="$WORK/.pgpass"
  : > "$PGPASSFILE"
  install_tools
  ask_inputs
  preflight
  dump_old
  prepare_data
  restore_new
  managed_extras
  apply_migrations
  copy_files
  verify_all
  cleanup
  printf '\n\033[1;32mПеренос завершён.\033[0m Сайт пока работает на старом Supabase — на новом сервере лежит копия.\n'
  echo "Пришлите скриншот сверки (таблица выше) — секретов в ней нет."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
