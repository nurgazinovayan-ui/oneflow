#!/usr/bin/env bash
# ONEFLOW — why a video generation is refused: reads the state of the KZ server and changes nothing.
#
#   sudo bash ~/oneflow-video-check/video-check.sh you@example.com
#
# 1. The functions on this server: the video functions that pass references to the model, the
#    OpenRouter key (set or not, never its value), the functions container.
# 2. The video storage: finished videos and the photo / video references go there, so it must take
#    those file types.
# 3. The settings that can refuse a video before any credits are counted.
# 4. For the account (optional): credits or the monthly allowance, what unfinished generations hold,
#    the last video attempts. Without an e-mail, only 1–3.
#
# The database session is read-only (default_transaction_read_only): even a query that tried to
# write would be refused. credit_balance() is not called on purpose: it may add the starter pack.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/oneflow/supabase}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
FN_CONTAINER="${FN_CONTAINER:-supabase-edge-functions}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUCKET=ai-generated-videos
OPEN="('pending', 'submitted', 'finishing')"
AGO="floor(extract(epoch from now() - created_at) / 3600)::int || ' ч ' || lpad((floor(extract(epoch from now() - created_at) / 60)::int % 60)::text, 2, '0') || ' мин назад'"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*"; FAILS=$(( FAILS + 1 )); }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
info() { printf '    · %s\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }
FAILS=0
trap 'printf "\n\033[1;31mПроверка остановилась на ошибке (строка %s). Пришлите скриншот. Ничего не изменено.\033[0m\n" "$LINENO" >&2' ERR

env_value() { local v; v=$(grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2-) || true; v=${v#\'}; printf '%s' "${v%\'}"; }

# One read-only query as the database superuser inside the db container; the password goes by name.
q() {
  PGPASSWORD=$(env_value "$APP_DIR/.env" POSTGRES_PASSWORD) \
    docker exec -e PGPASSWORD -e PGOPTIONS='-c default_transaction_read_only=on' "$DB_CONTAINER" \
    psql -U supabase_admin -h 127.0.0.1 -d postgres -X -q -v ON_ERROR_STOP=1 -At -c "$1"
}

[[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0 [e-mail]"
[[ -f "$APP_DIR/.env" ]] || die "Нет $APP_DIR/.env — это не сервер ONEFLOW?"
(cd "$HERE" && sha256sum -c --quiet SHA256SUMS) || die "Пакет повреждён — скачайте oneflow-video-check.tar.gz заново"
EMAIL="$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]')"
# a strict shape keeps quotes out of the queries below
[[ -z "$EMAIL" || "$EMAIL" =~ ^[a-z0-9._+-]+@[a-z0-9.-]+\.[a-z]{2,}$ ]] || die "Это не похоже на e-mail: $1"
[[ "$(q 'show default_transaction_read_only')" == on ]] || die "База не открылась в режиме только чтения — проверка остановлена"

# ---------------------------------------------------------------------------------------------
step "1/4 Функции на этом сервере"
fdir="$APP_DIR/volumes/functions"
for f in generate-video generate-video-pro; do
  if [[ ! -f "$fdir/$f/index.ts" ]]; then
    bad "нет функции $f"
  elif grep -q '^// ---- Video references' "$fdir/$f/index.ts"; then
    ok "$f — новая версия: фото и видео-референсы доходят до модели, отказ называет цену"
  else
    bad "$f — старая версия: референсы не доходят до модели. Установите oneflow-functions.tar.gz (install-functions.sh)"
  fi
done
if grep -Eq '^OPENROUTER_API_KEY=.+' "$APP_DIR/functions.env" 2>/dev/null; then
  ok "ключ OpenRouter задан (значение не показываю)"
else
  bad "ключ OpenRouter не задан — генерации не дойдут до провайдера (install-functions.sh спросит его)"
fi
state=$(docker inspect -f '{{.State.Health.Status}}' "$FN_CONTAINER" 2>/dev/null || true)
[[ "$state" == healthy ]] && ok "контейнер функций работает" || bad "контейнер функций: ${state:-не найден} (sudo docker logs --tail 50 $FN_CONTAINER)"

# ---------------------------------------------------------------------------------------------
step "2/4 Хранилище видео ($BUCKET)"
IFS='|' read -r pub size types <<<"$(q "select public::text, coalesce(file_size_limit::text, ''), coalesce(array_to_string(allowed_mime_types, ','), '') from storage.buckets where id = '$BUCKET'")" || true
if [[ -z "${pub:-}" ]]; then
  bad "хранилища нет — готовые видео и референсы некуда сохранить"
else
  [[ "$pub" == true ]] && ok "публичное: модель может скачать референс по ссылке" || bad "хранилище не публичное — модель не скачает референс, а приложение — готовое видео"
  [[ -n "$size" ]] && info "один файл до $(( size / 1048576 )) МБ" || info "размер файла не ограничен хранилищем"
  if [[ -z "$types" ]]; then
    ok "принимает любые типы файлов (фото и видео-референсы загрузятся)"
  else
    missing=()
    for t in image/png image/jpeg image/webp video/mp4; do
      [[ ",$types," == *",$t,"* || ",$types," == *",${t%%/*}/*,"* ]] || missing+=("$t")
    done
    if [[ ${#missing[@]} -eq 0 ]]; then
      ok "принимает фото и видео ($types)"
    else
      bad "не принимает ${missing[*]} — такие референсы не загрузятся, и генерация закончится ошибкой"
      info "исправление меняет базу, только с вашего разрешения: вернуть настройку из миграции (без ограничения типов)"
      info "  update storage.buckets set allowed_mime_types = null where id = '$BUCKET';"
    fi
  fi
  left=$(q "select count(*) from storage.objects where bucket_id = '$BUCKET' and name like 'refs/%' and created_at < now() - interval '1 day'")
  [[ "$left" == 0 ]] || info "референсов старше суток: $left (удаляются, когда задача закончена; оставшиеся — от прерванных задач)"
fi

# ---------------------------------------------------------------------------------------------
step "3/4 Настройки, которые могут отказать до подсчёта денег"
setting() { q "select coalesce((select value::text from public.app_settings where key = '$1'), '')"; }
v=$(setting paid_generation_enabled)
[[ "$v" == 0 ]] && bad "платные генерации выключены (paid_generation_enabled = 0)" || ok "платные генерации включены"
v=$(setting max_single_job_usd); info "одна генерация не дороже \$$v — дороже приложение ответит «слишком дорогой запрос»"
v=$(setting max_parallel_jobs); info "одновременно у аккаунта до $v незавершённых генераций"
for k in user_daily_usd_cap global_daily_usd_cap global_hourly_usd_cap; do
  v=$(setting "$k")
  case "$v" in ''|-1) info "$k: выключен" ;; *) info "$k: \$$v — при достижении «лимит расходов»" ;; esac
done
info "часов до автосписания неопрошенной видео-задачи: $(setting submitted_job_max_hours)"

# ---------------------------------------------------------------------------------------------
if [[ -z "$EMAIL" ]]; then
  step "4/4 Аккаунт — пропущено"
  info "чтобы проверить свой баланс: sudo bash $0 ваш@e-mail"
else
  step "4/4 Аккаунт $EMAIL"
  IFS='|' read -r uid confirmed <<<"$(q "select id, (email_confirmed_at is not null)::text from auth.users where lower(email) = '$EMAIL'")" || true
  if [[ -z "${uid:-}" ]]; then
    bad "такого аккаунта на этом сервере нет"
  else
    [[ "$confirmed" == true ]] && ok "почта подтверждена" || bad "почта не подтверждена — платные генерации не запускаются"
    [[ "$(q "select count(*) from public.generation_blocks where user_id = '$uid'")" == 0 ]] || bad "аккаунт заблокирован для платных генераций (generation_blocks)"
    IFS='|' read -r held_n held_cr held_usd <<<"$(q "select count(*), coalesce(sum(public.usd_to_credits(amount_usd)), 0), round(coalesce(sum(amount_usd), 0), 2) from public.generation_reservations where user_id = '$uid' and status in $OPEN")"
    override=$(q "select match || '|' || monthly_usd from public.generation_overrides where match = '$EMAIL' or (match like '@%' and '$EMAIL' like '%' || match) order by (match = '$EMAIL') desc, monthly_usd desc limit 1")
    if [[ -n "$override" ]]; then
      IFS='|' read -r allowance spent free positive <<<"$(q "with m as (select coalesce(public.generation_allowance('$uid'), 0) as a, coalesce((select sum(cost_usd) from public.generation_log where user_id = '$uid' and created_at >= date_trunc('month', now())), 0) as s) select round(a, 2), round(s, 2), round(a - s - $held_usd, 2), (a - s - $held_usd > 0)::text from m")"
      ok "месячный лимит вместо кредитов: \$$allowance (правило ${override%%|*})"
      info "потрачено в этом месяце: \$$spent; занято незавершёнными генерациями: \$$held_usd ($held_n шт.)"
      [[ "$positive" == true ]] && ok "свободно в лимите: \$$free — хватит на видео не дороже этого" || bad "лимит исчерпан: свободно \$$free — поэтому «недостаточно кредитов»"
    else
      avail=$(q "select public.credits_available('$uid')")
      warn "у аккаунта нет месячного лимита — генерации идут из кредитов"
      # the gate adds the starter pack (ensure_free_credits) on the first paid request of a confirmed account
      starter=$(setting free_credits); starter=${starter%%.*}
      if [[ "$confirmed" == true && "$(q "select count(*) from public.credit_packs where user_id = '$uid' and source = 'free'")" == 0 ]] && (( ${starter:-0} > 0 )); then
        info "стартовые $starter кредитов ещё не начислены — начислятся при первой генерации (учтены ниже)"
        avail=$(( avail + starter ))
      fi
      free=$(( avail - held_cr ))
      info "кредиты: $avail; заняты незавершёнными генерациями: $held_cr ($held_n шт.)"
      (( free > 0 )) && ok "свободно: $free кредитов (1 кредит = \$0.01) — хватит на видео не дороже этого; цена видна под кнопкой" || bad "свободно: $free кредитов — поэтому «недостаточно кредитов»"
    fi
    maxjobs=$(setting max_parallel_jobs); (( held_n < ${maxjobs:-6} )) || bad "незавершённых генераций $held_n — это предел, новая не запустится, пока они не закончатся"
    if (( held_n > 0 )); then
      info "незавершённые (держат деньги, пока не закончатся; видео — до $(setting submitted_job_max_hours) ч):"
      q "select '      ' || $AGO || '  ' || coalesce(function_name, category) || '  ' || model || '  ' || status || '  ' || public.usd_to_credits(amount_usd) || ' кр.' from public.generation_reservations where user_id = '$uid' and status in $OPEN order by created_at desc limit 10"
    fi
    info "последние попытки видео (сколько назад, функция, модель, итог, кредиты):"
    rows=$(q "select '      ' || $AGO || '  ' || coalesce(function_name, '') || '  ' || model || '  ' || status || coalesce(' (' || close_reason || ')', '') || '  ' || public.usd_to_credits(coalesce(cost_usd, amount_usd)) || ' кр.' from public.generation_reservations where user_id = '$uid' and category = 'video' order by created_at desc limit 10")
    [[ -n "$rows" ]] && printf '%s\n' "$rows" || info "  ни одной: видео до проверки денег не дошло или запросов не было"
    n=$(q "select count(*) from public.security_events where user_id = '$uid' and kind = 'job_auto_settled' and created_at > now() - interval '30 days'")
    [[ "$n" == 0 ]] || warn "за 30 дней видео-задач, списанных по оценке без опроса: $n (вкладку закрыли до готовности)"
  fi
fi

printf '\n'
if (( FAILS == 0 )); then
  printf '\033[1;32mПроблем не найдено.\033[0m Если видео всё равно не запускается — пришлите скриншот этого вывода и текста ошибки.\n'
else
  printf '\033[1;31mНайдено проблем: %s.\033[0m Пришлите скриншот этого вывода. Ничего не изменено.\n' "$FAILS"
fi
