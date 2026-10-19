#!/usr/bin/env bash
# ONEFLOW — installs the oneflow-site command (the website from this server instead of Vercel) and
# publishes the first release. Visitors see no change: until "sudo oneflow-site go-live" and the
# DNS change the site answers only on 127.0.0.1:8088, for the checks.
#
#   sudo bash ~/oneflow-site/install-site.sh ~/oneflow-art-site-v18.zip

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_PORT="${LOCAL_ADDR:-127.0.0.1:8088}"; LOCAL_PORT="${LOCAL_PORT##*:}"

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0 <site.zip>"
ZIP="${1:-}"
[[ -z "$ZIP" || -f "$ZIP" ]] || die "Нет файла $ZIP"

step "1/3 Пакет и сервер"
(cd "$HERE" && sha256sum -c --quiet SHA256SUMS) || die "Пакет повреждён — скачайте oneflow-site.tar.gz заново"
for c in caddy python3 curl flock; do command -v "$c" >/dev/null || die "Не найдено: $c — сначала oneflow-install.sh"; done
[[ -f /etc/caddy/Caddyfile ]] || die "Нет /etc/caddy/Caddyfile — сначала oneflow-install.sh"
systemctl is-active --quiet caddy || die "Caddy не запущен (sudo systemctl status caddy)"
command -v dig >/dev/null || apt-get install -y -qq dnsutils >/dev/null 2>&1 || die "Не удалось установить dnsutils (dig)"
# the check port must be free, or already Caddy's own (a re-run)
busy=$(ss -Htlnp "sport = :$LOCAL_PORT" 2>/dev/null || true)
[[ -z "$busy" || "$busy" == *caddy* ]] || die "Порт $LOCAL_PORT занят другой программой: $busy"
ok "Caddy работает, порт $LOCAL_PORT для проверок свободен"

step "2/3 Команда oneflow-site"
install -m 755 "$HERE/oneflow-site" /usr/local/sbin/oneflow-site
/usr/local/sbin/oneflow-site setup
ok "Установлена: sudo oneflow-site (deploy | rollback | status | dns | go-live | check)"

if [[ -n "$ZIP" ]]; then
  step "3/3 Первая версия сайта"
  /usr/local/sbin/oneflow-site deploy "$ZIP"
else
  printf '\nДальше: sudo oneflow-site deploy ~/oneflow-art-site-vNN.zip\n'
fi
