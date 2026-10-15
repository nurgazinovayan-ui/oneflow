#!/usr/bin/env bash
# ONEFLOW — установка Supabase на собственный сервер (Ubuntu 24.04).
#
#   sudo bash oneflow-install.sh
#
# Что делает (по шагам, с проверкой после каждого):
#   1. проверяет, что домен API указывает на этот сервер;
#   2. ставит Docker (если его нет) и запрещает контейнерам открывать порты наружу:
#      Docker обходит ufw, поэтому все опубликованные порты привязываются к 127.0.0.1;
#   3. ставит Caddy (HTTPS-сертификаты Let's Encrypt получает сам);
#   4. берёт официальную сборку Supabase (supabase/supabase, папка docker);
#   5. генерирует все секреты и настраивает адреса — один раз; при повторном запуске
#      секреты и база не трогаются;
#   6. запускает Supabase и ждёт, пока он ответит;
#   7. публикует наружу ТОЛЬКО пути API (/auth/v1, /rest/v1, /storage/v1, /functions/v1),
#      проверяет HTTPS и что база, пулер и Studio снаружи недоступны.
#
# Секреты пишутся в /opt/oneflow/supabase/.env (доступ только root) и на экран не выводятся.

set -Eeuo pipefail

DOMAIN="${DOMAIN:-api.oneflow.art}"
SITE_URL="${SITE_URL:-https://oneflow.art}"
REDIRECT_URLS="${REDIRECT_URLS:-https://oneflow.art/**,https://www.oneflow.art/**}"
APP_DIR="${APP_DIR:-/opt/oneflow/supabase}"
SRC_DIR="${SRC_DIR:-/opt/oneflow/supabase-src}"
SUPABASE_REPO="https://github.com/supabase/supabase.git"
INTERNAL_PORTS="5432|6543|8000|3000|4000|5000|9999"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

# Replace KEY=... in .env, or append it. The value is written as-is (no quotes).
set_env() {
  local key=$1 value=$2 file=${3:-$APP_DIR/.env} escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[\\|&]/\\&/g')
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}

get_env() { grep -E "^$1=" "${2:-$APP_DIR/.env}" | tail -n1 | cut -d= -f2-; }

check_dns() {
  step "1/7 Проверка домена $DOMAIN"
  command -v dig >/dev/null || apt-get install -y -qq bind9-dnsutils >/dev/null
  local dns_ip server_ips
  dns_ip=$(dig +short A "$DOMAIN" @1.1.1.1 | grep -E '^[0-9.]+$' | tail -n1 || true)
  server_ips=$(hostname -I)
  [[ -n "$dns_ip" ]] || die "Домен $DOMAIN пока не указывает ни на какой IP. Добавьте A-запись и подождите 5–10 минут."
  grep -qw -- "$dns_ip" <<<"$server_ips" \
    || die "Домен $DOMAIN указывает на $dns_ip, а у этого сервера адреса: $server_ips. Исправьте A-запись."
  ok "$DOMAIN → $dns_ip (это этот сервер)"
}

install_docker() {
  step "2/7 Docker"
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl git openssl gnupg >/dev/null
  if ! command -v docker >/dev/null; then
    install -m 0755 -d /etc/apt/keyrings
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
    chmod a+r /etc/apt/keyrings/docker.asc
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
      > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin >/dev/null
    ok "Docker установлен"
  else
    ok "Docker уже установлен"
  fi
  docker compose version >/dev/null || die "Не найден docker compose"

  # "ip" only covers Docker's default bridge; Supabase runs on its own compose network, so the
  # ports that matter are pinned to 127.0.0.1 in docker-compose.oneflow.yml (pin_ports).
  local want='{
  "ip": "127.0.0.1",
  "log-driver": "local",
  "log-opts": { "max-size": "20m", "max-file": "5" }
}'
  if [[ ! -f /etc/docker/daemon.json ]] || ! grep -q '"ip": "127.0.0.1"' /etc/docker/daemon.json; then
    [[ -f /etc/docker/daemon.json ]] && cp /etc/docker/daemon.json "/etc/docker/daemon.json.bak.$(date +%s)"
    mkdir -p /etc/docker
    printf '%s\n' "$want" > /etc/docker/daemon.json
    systemctl restart docker
    ok "Логи Docker ограничены по размеру"
  else
    ok "Docker уже настроен"
  fi
  systemctl enable --now docker >/dev/null 2>&1
}

install_caddy() {
  step "3/7 Caddy (HTTPS)"
  if ! command -v caddy >/dev/null; then
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https >/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
      | gpg --batch --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
      > /etc/apt/sources.list.d/caddy-stable.list
    chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
    apt-get update -qq
    apt-get install -y -qq caddy >/dev/null
    ok "Caddy установлен"
  else
    ok "Caddy уже установлен"
  fi
}

fetch_supabase() {
  step "4/7 Официальная сборка Supabase"
  mkdir -p "$(dirname "$APP_DIR")"
  if [[ -f "$APP_DIR/docker-compose.yml" ]]; then
    ok "Уже лежит в $APP_DIR — не перезаписываю"
    return
  fi
  rm -rf "$SRC_DIR"
  git clone -q --depth 1 --filter=blob:none --sparse "$SUPABASE_REPO" "$SRC_DIR"
  git -C "$SRC_DIR" sparse-checkout set docker
  mkdir -p "$APP_DIR"
  cp -a "$SRC_DIR/docker/." "$APP_DIR/"
  git -C "$SRC_DIR" rev-parse HEAD > "$APP_DIR/UPSTREAM_COMMIT"
  # the example function is public and unneeded; ONEFLOW functions are deployed separately
  rm -rf "$APP_DIR/volumes/functions/hello"
  ok "Сборка Supabase $(cut -c1-12 "$APP_DIR/UPSTREAM_COMMIT") скопирована в $APP_DIR"
}

configure_env() {
  step "5/7 Секреты и настройки"
  local env="$APP_DIR/.env"
  if [[ -f "$env" ]] && grep -q '^# oneflow-configured' "$env"; then
    ok "Уже настроено ранее — секреты не меняю (иначе база перестанет открываться)"
    return
  fi
  cp "$APP_DIR/.env.example" "$env"
  chmod 600 "$env"
  # official generator: JWT secret, anon/service keys, DB and dashboard passwords, encryption keys
  (cd "$APP_DIR" && sh utils/generate-keys.sh --update-env >/dev/null)
  rm -f "$APP_DIR/.env.old"

  set_env SUPABASE_PUBLIC_URL "https://$DOMAIN"
  set_env API_EXTERNAL_URL "https://$DOMAIN/auth/v1"
  set_env SITE_URL "$SITE_URL"
  set_env ADDITIONAL_REDIRECT_URLS "$REDIRECT_URLS"
  set_env DASHBOARD_USERNAME "oneflow-admin"
  set_env POOLER_TENANT_ID "oneflow"
  set_env STUDIO_DEFAULT_ORGANIZATION "ONEFLOW"
  set_env STUDIO_DEFAULT_PROJECT "oneflow"
  set_env OPENAI_API_KEY ""
  # phone sign-up is on and auto-confirmed upstream: anyone could create accounts without
  # any verification. ONEFLOW signs up by e-mail (confirmed) and Google only.
  set_env ENABLE_PHONE_SIGNUP "false"
  set_env ENABLE_PHONE_AUTOCONFIRM "false"
  set_env ENABLE_ANONYMOUS_USERS "false"
  set_env ENABLE_EMAIL_SIGNUP "true"
  set_env ENABLE_EMAIL_AUTOCONFIRM "false"
  set_env DISABLE_SIGNUP "false"

  # nothing may still hold an example value
  local leftovers
  leftovers=$(grep -nE '^(POSTGRES_PASSWORD|JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY|DASHBOARD_PASSWORD|SECRET_KEY_BASE|VAULT_ENC_KEY|PG_META_CRYPTO_KEY|REALTIME_DB_ENC_KEY|LOGFLARE_PUBLIC_ACCESS_TOKEN|LOGFLARE_PRIVATE_ACCESS_TOKEN|S3_PROTOCOL_ACCESS_KEY_ID|S3_PROTOCOL_ACCESS_KEY_SECRET)=' "$env" \
    | while IFS= read -r line; do
        k=${line#*:}; k=${k%%=*}
        if [[ "$(get_env "$k" "$env")" == "$(get_env "$k" "$APP_DIR/.env.example")" ]]; then echo "$k"; fi
      done)
  [[ -z "$leftovers" ]] || die "Остались примерные значения: $leftovers"
  printf '\n# oneflow-configured %s\n' "$(date -u +%FT%TZ)" >> "$env"
  chown root:root "$env"; chmod 600 "$env"
  ok "Секреты сгенерированы и сохранены в $env (только для root)"
}

pin_ports() {
  # Docker writes its own iptables rules and bypasses ufw: a bare "8000:8000" in the upstream
  # compose file is reachable from the internet. The gateway and the database pooler are
  # re-published on 127.0.0.1 only; Caddy is the single public entry point.
  cat > "$APP_DIR/docker-compose.oneflow.yml" <<'EOF'
# ONEFLOW: the API gateway and the database pooler listen on localhost only.
# Docker bypasses ufw, so a bare "8000:8000" would be reachable from the internet.
services:
  api-gw:
    ports: !override
      - "127.0.0.1:8000:8000/tcp"
  supavisor:
    ports: !override
      - "127.0.0.1:5432:5432"
      - "127.0.0.1:6543:6543"
EOF
  set_env COMPOSE_FILE "docker-compose.yml:docker-compose.oneflow.yml"
  (cd "$APP_DIR" && docker compose config --format json >/dev/null) || die "docker compose не принял docker-compose.oneflow.yml"
  ok "Порты шлюза (8000) и базы (5432/6543) — только 127.0.0.1"
}

start_supabase() {
  step "6/7 Запуск Supabase (первый раз скачивается ~3–4 ГБ, это 5–15 минут)"
  cd "$APP_DIR"
  docker compose pull -q
  docker compose up -d
  local anon i
  anon=$(get_env ANON_KEY)
  for i in $(seq 1 90); do
    if curl -fsS -o /dev/null -H "apikey: $anon" http://127.0.0.1:8000/auth/v1/health 2>/dev/null; then
      ok "Supabase отвечает (вход и регистрация работают)"
      return
    fi
    sleep 5
  done
  docker compose ps
  die "Supabase не ответил за 7,5 минут. Пришлите скриншот таблицы выше."
}

# $1 = output file, $2 = site address (the domain; tests use a plain :port)
write_caddyfile() {
  cat > "$1" <<EOF
# ONEFLOW API — generated by oneflow-install.sh
$2 {
	encode zstd gzip

	# Only the API is public. Studio (/), postgres-meta (/pg/) and everything else stay
	# reachable from the server itself only (SSH tunnel to 127.0.0.1:8000).
	@api path /auth/v1/* /rest/v1/* /storage/v1/* /functions/v1/*
	handle @api {
		reverse_proxy 127.0.0.1:8000 {
			# the gateway behind us only sees Docker's address; the functions read the
			# client address from X-Real-IP, which only Caddy sets (a client copy is replaced)
			header_up X-Real-IP {remote_host}
			header_up -CF-Connecting-IP
		}
	}
	handle {
		respond "Not found" 404
	}

	header {
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		-Server
	}

	log {
		output file ${CADDY_LOG:-/var/log/caddy/api-access.log} {
			roll_size 50MiB
			roll_keep 10
		}
	}
}
EOF
}

configure_caddy() {
  step "7/7 HTTPS и закрытие лишнего"
  local caddyfile=/etc/caddy/Caddyfile
  if [[ -f "$caddyfile" && ! -f "$caddyfile.orig" ]]; then cp "$caddyfile" "$caddyfile.orig"; fi
  write_caddyfile "$caddyfile" "$DOMAIN"
  # The access log must belong to the caddy user: `caddy validate` runs as root here and
  # would otherwise create it root-owned, and the service could then not load the config.
  local access_log=/var/log/caddy/api-access.log
  install -d -m 0755 -o caddy -g caddy /var/log/caddy
  touch "$access_log"; chown caddy:caddy "$access_log"
  caddy validate --config "$caddyfile" --adapter caddyfile >/dev/null 2>&1 || die "Ошибка в конфигурации Caddy"
  chown caddy:caddy /var/log/caddy/api-access.log* 2>/dev/null || true
  systemctl enable --now caddy >/dev/null 2>&1
  systemctl reload caddy 2>/dev/null || systemctl restart caddy

  local anon i code
  anon=$(get_env ANON_KEY)
  for i in $(seq 1 36); do
    if curl -fsS -o /dev/null -H "apikey: $anon" "https://$DOMAIN/auth/v1/health" 2>/dev/null; then
      ok "https://$DOMAIN работает, сертификат выпущен"
      break
    fi
    [[ $i -eq 36 ]] && die "HTTPS не заработал за 3 минуты. Проверьте, что порты 80 и 443 открыты (sudo ufw status), и пришлите скриншот."
    sleep 5
  done

  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/")
  [[ "$code" == 404 ]] || die "Корень https://$DOMAIN/ отвечает $code, а должен 404 (Studio не должна быть видна снаружи)"
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/pg/tables")
  [[ "$code" == 404 ]] || die "/pg/ отвечает $code, а должен 404"
  ok "Studio и служебные пути снаружи закрыты (404)"

  local exposed
  command -v ss >/dev/null || apt-get install -y -qq iproute2 >/dev/null
  exposed=$(ss -Htln | awk '{print $4}' | grep -E "^(0\.0\.0\.0|\*|\[::\]):(${INTERNAL_PORTS})$" || true)
  [[ -z "$exposed" ]] || die "Наружу открыты внутренние порты: $exposed"
  ok "База (5432/6543) и шлюз (8000) слушают только 127.0.0.1"
}

summary() {
  cat <<EOF

$(printf '\033[1;32m')Готово.$(printf '\033[0m')

  API:        https://$DOMAIN
  Файлы:      $APP_DIR
  Секреты:    $APP_DIR/.env  (только root; не копируйте и не фотографируйте)

  Состояние:  cd $APP_DIR && sudo docker compose ps
  Studio:     только через SSH-туннель, см. инструкцию.

Пришлите скриншот этого окна (секретов на нём нет).
EOF
}

main() {
  [[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0"
  # shellcheck disable=SC1091
  . /etc/os-release
  [[ "$ID" == ubuntu ]] || die "Скрипт рассчитан на Ubuntu"
  [[ "$VERSION_ID" == "24.04" ]] || warn "Проверено на Ubuntu 24.04, у вас $VERSION_ID"
  trap 'die "Ошибка в строке $LINENO. Пришлите скриншот этого окна."' ERR
  check_dns
  install_docker
  install_caddy
  fetch_supabase
  configure_env
  pin_ports
  start_supabase
  configure_caddy
  summary
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
