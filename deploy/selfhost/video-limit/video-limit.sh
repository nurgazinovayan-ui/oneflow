#!/usr/bin/env bash
# ONEFLOW — raises the single-job ceiling (app_settings.max_single_job_usd) on the KZ server to the
# price of the most expensive video the app can order: Seedance 2.5, 1080p, 30 s = $12 (1200
# credits). At $5 the app offers videos that are always refused («слишком дорогой запрос»).
#
#   sudo bash ~/oneflow-video-limit/video-limit.sh              shows, asks «да», raises to $12
#   sudo bash ~/oneflow-video-limit/video-limit.sh --rollback   back to the value before the raise
#
# Changes one row, only after «да», in one transaction with a record in security_events (the old
# and the new value, which --rollback reads). Credits, the monthly allowance, the rate limits, the
# parallel-job limit and the kill switch are not touched. The functions read the setting on every
# request: nothing to restart.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/oneflow/supabase}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
KEY=max_single_job_usd
TARGET=12   # checked against the price tables by pack-video-limit.sh
TAG=video-limit.sh

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
info() { printf '    · %s\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }
trap 'printf "\n\033[1;31mОстановлено на ошибке (строка %s). Пришлите скриншот.\033[0m\n" "$LINENO" >&2' ERR

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
number() { [[ "$1" =~ ^[0-9]+(\.[0-9]+)?$ ]]; }

[[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0"
[[ -f "$APP_DIR/.env" ]] || die "Нет $APP_DIR/.env — это не сервер ONEFLOW?"
(cd "$HERE" && sha256sum -c --quiet SHA256SUMS) || die "Пакет повреждён — скачайте oneflow-video-limit.tar.gz заново"
[[ "$(q "select to_regclass('public.security_events') is not null")" == t ]] || die "Нет журнала security_events — база не та, что ожидалась"

current=$(q "select value from public.app_settings where key = '$KEY'")
number "$current" || die "Настройки $KEY нет или она не число ('$current')"

# apply <from> <to> <by>: one row and its journal record together; refused if the value changed since it was read
apply() {
  local from=$1 to=$2 by=$3
  db <<SQL
do \$fn\$ begin
  update public.app_settings set value = $to where key = '$KEY' and value = $from;
  if not found then raise exception 'changed_meanwhile'; end if;
  perform public.log_security_event('setting_changed', 'warning', null,
    jsonb_build_object('key', '$KEY', 'from', $from, 'to', $to, 'by', '$by'), null);
end \$fn\$;
SQL
  [[ "$(q "select value = $to from public.app_settings where key = '$KEY'")" == t ]] || die "После записи значение не то — пришлите скриншот"
}

confirm() {
  local ans
  read -r -p "    Введите «да», чтобы применить: " ans || ans=
  [[ "$ans" == да ]] || { info "ничего не изменено"; exit 0; }
}

if [[ "${1:-}" == --rollback ]]; then
  step "Откат лимита одной генерации"
  prev=$(q "select details->>'from' from public.security_events where kind = 'setting_changed' and details->>'key' = '$KEY' and details->>'by' = '$TAG' order by id desc limit 1")
  number "$prev" || die "Этот скрипт лимит не менял — откатывать нечего"
  last=$(q "select details->>'to' from public.security_events where kind = 'setting_changed' and details->>'key' = '$KEY' and details->>'by' = '$TAG' order by id desc limit 1")
  [[ "$(q "select $current = $last")" == t ]] || die "Сейчас \$$current, а не \$$last: значение меняли после скрипта — откат не делаю"
  info "сейчас: одна генерация не дороже \$$current"
  info "станет: \$$prev (как было до повышения)"
  confirm
  apply "$current" "$prev" "$TAG --rollback"
  ok "лимит одной генерации: \$$prev"
  exit 0
fi

step "Лимит одной генерации"
info "сейчас: одна генерация не дороже \$$current"
if [[ "$(q "select $current >= $TARGET")" == t ]]; then
  ok "уже не меньше \$$TARGET — ничего не меняю"
  exit 0
fi
info "самое дорогое видео в приложении: Seedance 2.5, 1080p, 30 с = \$$TARGET (1200 кредитов)"
info "станет: \$$TARGET — так приложение не предлагает видео, которое сервер всегда отклонит"
info "остальные защиты не меняются: кредиты и месячный лимит, частота запросов,"
info "до $(q "select value from public.app_settings where key = 'max_parallel_jobs'") генераций одновременно, общий выключатель"
confirm
apply "$current" "$TARGET" "$TAG"
ok "лимит одной генерации: \$$TARGET (записано в журнал security_events)"
info "перезапуск не нужен: функции читают настройку при каждом запросе"
info "откат: sudo bash $0 --rollback"
