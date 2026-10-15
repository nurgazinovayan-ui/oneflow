#!/usr/bin/env bash
# ONEFLOW — функции и ключи сервисов на собственном сервере (после oneflow-install.sh).
#
#   tar xzf oneflow-functions.tar.gz && sudo bash oneflow-functions/install-functions.sh
#
# 1. Спрашивает ключи сервисов по одному (ввод скрыт, на экран не выводится) и сохраняет их в
#    /opt/oneflow/supabase/functions.env (только root). Enter — оставить сохранённое ранее.
# 2. Копирует функции ONEFLOW и роутер (проверка входа для каждой функции отдельно).
# 3. Подключает ключи к контейнеру функций; ссылки на файлы строятся от https://api.oneflow.art.
# 4. Проверяет снаружи: функции запускаются, без входа не пускают, вебхук принимает только подпись.
#
# Повторный запуск безопасен: обновляет код функций, ключи можно оставить или заменить.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/oneflow/supabase}"
DOMAIN="${DOMAIN:-api.oneflow.art}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$APP_DIR/functions.env"
OVERRIDE="docker-compose.functions.yml"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# KEY=VALUE or KEY='VALUE' from an env file, without the quotes
get_env() {
  local v
  v=$(grep -E "^$1=" "${2:-$APP_DIR/.env}" 2>/dev/null | tail -n1 | cut -d= -f2-) || true
  v=${v#\'}; v=${v%\'}
  printf '%s' "$v"
}

set_env() {
  local key=$1 value=$2 file=${3:-$APP_DIR/.env} escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[\\|&]/\\&/g')
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

# Adds a compose file to COMPOSE_FILE in .env, keeping the ones already listed.
compose_files_add() {
  local current; current=$(get_env COMPOSE_FILE)
  [[ -n "$current" ]] || current="docker-compose.yml"
  case ":$current:" in *":$1:"*) return ;; esac
  set_env COMPOSE_FILE "$current:$1"
}

# ---------------------------------------------------------------------------------------------
# Secrets
declare -A VAL=()
ORDER=(OPENROUTER_API_KEY LEMONSQUEEZY_WEBHOOK_SECRET REPLICATE_API_KEY OPENAI_API_KEY APIFY_API_TOKEN
       GIPHY_API_KEY YANDEX_CLIENT_ID YANDEX_CLIENT_SECRET YANDEX_TOKEN_ENCRYPTION_KEY ADMIN_EMAILS
       ALERT_WEBHOOK_URL CRON_SECRET IP_HASH_SALT)

clean() { local v=${1//$'\r'/}; v="${v#"${v%%[![:space:]]*}"}"; printf '%s' "${v%"${v##*[![:space:]]}"}"; }

# ask KEY "описание" required|optional hidden|visible [regex] [пример формата]
ask() {
  local key=$1 label=$2 need=$3 mode=$4 re=${5:-} hint=${6:-} cur value prompt
  cur=$(get_env "$key" "$ENV_FILE")
  while true; do
    printf '\n  \033[1m%s\033[0m — %s\n' "$key" "$label"
    if [[ -n "$cur" ]]; then prompt="    Вставьте значение (Enter — оставить сохранённое, ${#cur} симв.; «-» — удалить): "
    elif [[ "$need" == optional ]]; then prompt="    Вставьте значение (Enter — пропустить): "
    else prompt="    Вставьте значение: "; fi
    if [[ "$mode" == hidden ]]; then
      read -r -s -p "$prompt" value || value=""; echo
    else
      read -r -p "$prompt" value || value=""
    fi
    value=$(clean "$value")
    if [[ -z "$value" ]]; then
      if [[ -n "$cur" ]]; then VAL[$key]=$cur; ok "оставлено сохранённое"; return; fi
      if [[ "$need" == optional ]]; then VAL[$key]=""; warn "пропущено"; return; fi
      warn "это обязательный ключ"; continue
    fi
    if [[ "$value" == "-" ]]; then VAL[$key]=""; warn "удалено"; return; fi
    # the same key pasted twice or more before Enter arrives as one long value
    local k part rep i dup=0
    for k in 2 3 4 5; do
      (( ${#value} % k == 0 )) || continue
      part=${value:0:$(( ${#value} / k ))}; rep=""
      for ((i = 0; i < k; i++)); do rep+=$part; done
      if [[ "$rep" == "$value" ]]; then dup=$k; break; fi
    done
    if (( dup )); then warn "ключ вставлен $dup раза подряд — вставьте его один раз"; continue; fi
    if [[ "$value" == *"'"* || "$value" == *$'\n'* ]]; then warn "в значении не должно быть апострофа ' — проверьте, что скопировали только ключ"; continue; fi
    if [[ -n "$re" && ! "$value" =~ $re ]]; then warn "не похоже на этот ключ${hint:+ (ожидается: $hint)} — вставьте ещё раз"; continue; fi
    VAL[$key]=$value
    if [[ "$mode" == hidden ]]; then ok "сохранено (${#value} симв.)"; else ok "сохранено: $value"; fi
    return
  done
}

collect_secrets() {
  step "1/4 Ключи сервисов"
  echo "    Ввод ключей скрыт: после вставки (правой кнопкой мыши) на экране ничего не появится — это нормально."
  echo "    Нажмите Enter после каждого ключа."
  ask OPENROUTER_API_KEY "генерации (openrouter.ai → Keys)" required hidden '^sk-or-' 'sk-or-…'
  ask LEMONSQUEEZY_WEBHOOK_SECRET "подпись вебхука подписок (LemonSqueezy → Settings → Webhooks)" optional hidden
  ask REPLICATE_API_KEY "удаление фона и апскейл (replicate.com → API tokens)" optional hidden '^r8_' 'r8_…'
  ask OPENAI_API_KEY "marketing-ai (platform.openai.com → API keys)" optional hidden '^sk-' 'sk-…'
  ask APIFY_API_TOKEN "Trendswatching (apify.com → Settings → API)" optional hidden '^apify_api_' 'apify_api_…'
  ask GIPHY_API_KEY "GIF в мессенджере (developers.giphy.com)" optional hidden
  ask YANDEX_CLIENT_ID "Яндекс.Диск: ID приложения (oauth.yandex.ru)" optional visible '^[0-9a-f]{32}$' '32 символа 0-9a-f'
  ask YANDEX_CLIENT_SECRET "Яндекс.Диск: секрет приложения (oauth.yandex.ru)" optional hidden '^[0-9a-f]{32}$' '32 символа 0-9a-f'
  ask YANDEX_TOKEN_ENCRYPTION_KEY "ключ шифрования токенов Яндекса — ТОТ ЖЕ, что в старом Supabase. Нет его — Enter, создам новый" optional hidden '^[A-Za-z0-9+/]{43}=$' 'base64, 44 символа'
  if [[ -z "${VAL[YANDEX_TOKEN_ENCRYPTION_KEY]}" ]]; then
    VAL[YANDEX_TOKEN_ENCRYPTION_KEY]=$(openssl rand -base64 32)
    warn "создан новый ключ шифрования: пользователям нужно будет заново подключить Яндекс.Диск"
  fi
  ask ADMIN_EMAILS "email администраторов через запятую (Enter — владелец из кода)" optional visible '^[^ ,]+@[^ ,]+(,[^ ,]+@[^ ,]+)*$' 'name@example.com'
  ask ALERT_WEBHOOK_URL "куда слать уведомления о расходе (https://…, можно пропустить)" optional visible '^https://' 'https://…'
  # generated, never shown
  VAL[CRON_SECRET]=$(get_env CRON_SECRET "$ENV_FILE"); [[ -n "${VAL[CRON_SECRET]}" ]] || VAL[CRON_SECRET]=$(openssl rand -hex 32)
  VAL[IP_HASH_SALT]=$(get_env IP_HASH_SALT "$ENV_FILE"); [[ -n "${VAL[IP_HASH_SALT]}" ]] || VAL[IP_HASH_SALT]=$(openssl rand -hex 32)

  local tmp k
  tmp=$(mktemp)
  chmod 600 "$tmp"
  {
    echo "# ONEFLOW Edge Function secrets — written by install-functions.sh. root only; never copy."
    for k in "${ORDER[@]}"; do
      [[ -n "${VAL[$k]:-}" ]] && printf "%s='%s'\n" "$k" "${VAL[$k]}"
    done
  } > "$tmp"
  install -m 600 -o root -g root "$tmp" "$ENV_FILE"
  rm -f "$tmp"
  ok "Ключи сохранены в $ENV_FILE (только root)"
}

# ---------------------------------------------------------------------------------------------
install_code() {
  step "2/4 Код функций"
  local fdir="$APP_DIR/volumes/functions" n=0 d name
  [[ -d "$HERE/functions" && -f "$HERE/main/index.ts" ]] || die "Рядом со скриптом нет папок functions/ и main/ — распакуйте архив целиком"
  mkdir -p "$APP_DIR/backup"
  if [[ -f "$fdir/main/index.ts" ]] && ! grep -q 'ONEFLOW edge-runtime router' "$fdir/main/index.ts"; then
    cp "$fdir/main/index.ts" "$APP_DIR/backup/main-index.upstream.ts"
  fi
  install -m 644 "$HERE/main/index.ts" "$fdir/main/index.ts"
  for d in "$HERE"/functions/*/; do
    name=$(basename "$d")
    [[ "$name" =~ ^[a-z0-9][a-z0-9-]*$ && "$name" != main ]] || continue
    rm -rf "${fdir:?}/$name"
    cp -a "$d" "$fdir/$name"
    n=$((n + 1))
  done
  chown -R root:root "$fdir"
  ok "Установлено функций: $n, роутер с проверкой входа для каждой функции"
}

configure_container() {
  step "3/4 Подключение ключей к контейнеру функций"
  cat > "$APP_DIR/$OVERRIDE" <<EOF
# ONEFLOW: secrets for the functions, public base URL for the links they return, JWT check on
# (per function, see volumes/functions/main/index.ts).
services:
  functions:
    env_file:
      - ./functions.env
    environment:
      SUPABASE_URL: https://$DOMAIN
      VERIFY_JWT: "true"
EOF
  compose_files_add docker-compose.oneflow.yml
  compose_files_add "$OVERRIDE"
  cd "$APP_DIR"
  docker compose config --format json >/dev/null || die "docker compose не принял $OVERRIDE"
  docker compose up -d --force-recreate --no-deps functions >/dev/null 2>&1
  local i state
  for i in $(seq 1 30); do
    state=$(docker inspect -f '{{.State.Health.Status}}' supabase-edge-functions 2>/dev/null || true)
    [[ "$state" == healthy ]] && { ok "Контейнер функций перезапущен с ключами"; return; }
    sleep 2
  done
  docker compose logs --tail 30 functions
  die "Контейнер функций не поднялся. Пришлите скриншот."
}

# status of a request; second line: sb-error-code header (set by the router, not by our code)
probe() {
  local method=$1 path=$2 auth=${3:-} hdr code err
  hdr=$(mktemp)
  local args=(-s -o /dev/null -D "$hdr" -w '%{http_code}' -m 120 -X "$method" "https://$DOMAIN$path"
              -H 'Content-Type: application/json' -H 'Origin: https://oneflow.art')
  [[ -n "$auth" ]] && args+=(-H "Authorization: Bearer $auth" -H "apikey: $auth")
  [[ "$method" == POST ]] && args+=(--data '{}')
  code=$(curl "${args[@]}" || true)
  err=$(grep -i '^sb-error-code:' "$hdr" | cut -d: -f2- | tr -d ' \r' || true)
  rm -f "$hdr"
  printf '%s %s' "$code" "${err:--}"
}

smoke_test() {
  step "4/4 Проверка (первый вызов скачивает библиотеки, до 1 минуты)"
  local anon r code err fail=0
  anon=$(get_env ANON_KEY)

  r=$(probe OPTIONS /functions/v1/generate-image); code=${r%% *}
  [[ "$code" =~ ^20[04]$ ]] && ok "CORS-запрос к generate-image: $code" || { warn "CORS: $code"; fail=1; }

  r=$(probe POST /functions/v1/generate-image); code=${r%% *}; err=${r#* }
  [[ "$code" == 401 && "$err" != - ]] && ok "Без входа роутер не пускает в generate-image (401)" || { warn "без входа: $code $err"; fail=1; }

  r=$(probe POST /functions/v1/generate-image "$anon"); code=${r%% *}; err=${r#* }
  [[ "$code" == 401 && "$err" == - ]] && ok "generate-image запустилась и требует вход пользователя (401 из функции)" || { warn "generate-image: $code $err"; fail=1; }

  r=$(probe POST /functions/v1/lemonsqueezy-webhook); code=${r%% *}; err=${r#* }
  [[ "$code" == 401 && "$err" == - ]] && ok "Вебхук доступен без входа, но без подписи отклоняет (401 из функции)" || { warn "вебхук: $code $err"; fail=1; }

  r=$(probe POST /functions/v1/messenger-list-channels "$anon"); code=${r%% *}; err=${r#* }
  [[ "$code" =~ ^4 && "$err" == - ]] && ok "messenger-list-channels запустилась ($code)" || { warn "messenger-list-channels: $code $err"; fail=1; }

  r=$(probe POST /functions/v1/no-such-function "$anon"); code=${r%% *}
  [[ "$code" == 404 ]] && ok "Несуществующая функция: 404" || { warn "несуществующая функция: $code"; fail=1; }

  if [[ $fail -ne 0 ]]; then
    echo; (cd "$APP_DIR" && docker compose logs --tail 60 functions 2>/dev/null | grep -vE 'serving the request|Legacy token' | tail -25) || true
    die "Есть проблемы — пришлите скриншот всего окна (секретов в нём нет)."
  fi
}

main() {
  [[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0"
  [[ -f "$APP_DIR/.env" ]] && grep -q '^# oneflow-configured' "$APP_DIR/.env" || die "Сначала выполните oneflow-install.sh"
  trap 'die "Ошибка в строке $LINENO. Пришлите скриншот этого окна."' ERR
  collect_secrets
  install_code
  configure_container
  smoke_test
  printf '\n\033[1;32mГотово.\033[0m Функции работают. База ещё пустая — генерации заработают после переноса данных.\n'
  echo "Пришлите скриншот этого окна (секретов в нём нет)."
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
