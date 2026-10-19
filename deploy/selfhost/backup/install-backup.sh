#!/usr/bin/env bash
# ONEFLOW — set up encrypted off-site backups of the KZ server.
#
#   sudo bash ~/oneflow-backup/install-backup.sh
#
#   1. restic and zstd from the Ubuntu repository;
#   2. the S3 storage (address, bucket, keys — the secret key is typed hidden);
#   3. the encryption password: made up by you in a password manager, typed twice, hidden.
#      Without it nobody — neither you, nor us, nor the storage provider — can read the backups,
#      so keep it OFF this server as well;
#   4. the repository is created (or the existing one is opened with that password);
#   5. /usr/local/sbin/oneflow-backup, nightly backup 02:30 and weekly check (Asia/Almaty),
#      then the first backup runs right away.
# Safe to run again: Enter keeps what is already set. Secrets never go on a command line and live
# only in /etc/oneflow-backup (700 root).

set -Eeuo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONF_DIR=/etc/oneflow-backup
APP_DIR=/opt/oneflow/supabase

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

clean() { local v=${1//$'\r'/}; v="${v#"${v%%[![:space:]]*}"}"; printf '%s' "${v%"${v##*[![:space:]]}"}"; }
conf_value() { local v; v=$(grep -E "^$1=" "$CONF_DIR/env" 2>/dev/null | tail -n1 | cut -d= -f2-) || true; v=${v#\'}; printf '%s' "${v%\'}"; }
ask() {  # prompt default → REPLY_VALUE
  local v; read -r -p "$1" v || die "Ввод прерван"; v=$(clean "$v"); REPLY_VALUE=${v:-$2}
}
ask_hidden() {
  local v; read -r -s -p "$1" v || die "Ввод прерван"; echo; REPLY_VALUE=$(clean "$v")
}
no_quote() { [[ "$1" != *"'"* ]] || die "Апостроф (') в значении не поддерживается — скопируйте ещё раз."; }

install_tools() {
  step "1/5 Программы"
  if ! command -v restic >/dev/null || ! command -v zstd >/dev/null; then
    apt-get update -qq && apt-get install -y -qq restic zstd >/dev/null
  fi
  ok "$(restic version | cut -d' ' -f1-2), zstd $(zstd -V | sed -nE 's/.* (v[0-9.]+).*/\1/p')"
  docker inspect supabase-db >/dev/null 2>&1 || die "Контейнер базы supabase-db не найден — Supabase запущен?"
}

ask_storage() {
  step "2/5 Хранилище S3 (у другого провайдера, в Казахстане)"
  echo "    Данные — из личного кабинета хранилища: адрес (endpoint), бакет, ключ доступа и секретный ключ."
  local cur_repo cur_endpoint cur_bucket
  cur_repo=$(conf_value RESTIC_REPOSITORY)
  if [[ "$cur_repo" =~ ^s3:(https://[^/]+)/([^/]+)/ ]]; then cur_endpoint=${BASH_REMATCH[1]}; cur_bucket=${BASH_REMATCH[2]}; fi
  while true; do
    ask "    Адрес хранилища, например https://s3.example.kz${cur_endpoint:+ (Enter — $cur_endpoint)}: " "${cur_endpoint:-}"
    [[ "$REPLY_VALUE" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]] && { ENDPOINT=${REPLY_VALUE%/}; break; }
    warn "Нужен адрес вида https://… (без пути). Только https — копии не должны идти открытым каналом."
  done
  while true; do
    ask "    Бакет${cur_bucket:+ (Enter — $cur_bucket)}: " "${cur_bucket:-}"
    [[ "$REPLY_VALUE" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] && { BUCKET=$REPLY_VALUE; break; }
    warn "Имя бакета: строчные латинские буквы, цифры, точка и дефис, 3–63 символа."
  done
  ask "    Регион (Enter — $(conf_value AWS_DEFAULT_REGION | grep . || echo us-east-1)): " "$(conf_value AWS_DEFAULT_REGION | grep . || echo us-east-1)"
  REGION=$REPLY_VALUE; [[ "$REGION" =~ ^[A-Za-z0-9-]+$ ]] || die "Регион: латинские буквы, цифры и дефис"
  local cur_key; cur_key=$(conf_value AWS_ACCESS_KEY_ID)
  ask "    Ключ доступа (Access key ID)${cur_key:+ (Enter — оставить сохранённый)}: " "$cur_key"
  ACCESS_KEY=$REPLY_VALUE; [[ -n "$ACCESS_KEY" ]] || die "Нужен ключ доступа"; no_quote "$ACCESS_KEY"
  if [[ -n "$(conf_value AWS_SECRET_ACCESS_KEY)" && "$ACCESS_KEY" == "$cur_key" ]]; then
    ask_hidden "    Секретный ключ (ввод скрыт; Enter — оставить сохранённый): "
    SECRET_KEY=${REPLY_VALUE:-$(conf_value AWS_SECRET_ACCESS_KEY)}
  else
    ask_hidden "    Секретный ключ (Secret access key, ввод скрыт): "
    SECRET_KEY=$REPLY_VALUE
  fi
  [[ -n "$SECRET_KEY" ]] || die "Нужен секретный ключ"; no_quote "$SECRET_KEY"
  ok "Хранилище: $ENDPOINT, бакет $BUCKET"
}

ask_password() {
  step "3/5 Пароль шифрования копий"
  if [[ -s "$CONF_DIR/restic-password" ]]; then
    ask_hidden "    Пароль уже сохранён на сервере. Enter — оставить его, или введите новый для НОВОГО хранилища: "
    if [[ -z "$REPLY_VALUE" ]]; then ok "Пароль без изменений"; PASSWORD=""; return 0; fi
  else
    echo "    Придумайте пароль в менеджере паролей (не меньше 20 символов) и сохраните его там."
    echo "    Без него копии не расшифровать никому. Он нужен будет, если этот сервер пропадёт."
    ask_hidden "    Пароль (ввод скрыт): "
  fi
  local first=$REPLY_VALUE
  (( ${#first} >= 20 )) || die "Пароль короче 20 символов — придумайте длиннее"
  ask_hidden "    Ещё раз, для проверки (ввод скрыт): "
  [[ "$REPLY_VALUE" == "$first" ]] || die "Пароли не совпали — ничего не сохранено"
  PASSWORD=$first
  ok "Пароль принят"
}

open_repo() {
  step "4/5 Подключение к хранилищу"
  install -d -m 700 "$CONF_DIR"
  # settings and password are tried from temporary files and saved only after the repository
  # opened (or was created) with them — a mistyped password never replaces the working one
  local env_tmp pw_tmp out
  env_tmp=$(mktemp "$CONF_DIR/.env.XXXXXX"); pw_tmp=$(mktemp "$CONF_DIR/.pw.XXXXXX")
  {
    echo "# ONEFLOW backup — written by install-backup.sh"
    echo "RESTIC_REPOSITORY='s3:$ENDPOINT/$BUCKET/oneflow/$(hostname)'"
    echo "AWS_ACCESS_KEY_ID='$ACCESS_KEY'"
    echo "AWS_SECRET_ACCESS_KEY='$SECRET_KEY'"
    echo "AWS_DEFAULT_REGION='$REGION'"
  } > "$env_tmp"
  if [[ -n "$PASSWORD" ]]; then printf '%s' "$PASSWORD" > "$pw_tmp"; else cat "$CONF_DIR/restic-password" > "$pw_tmp"; fi
  chmod 600 "$env_tmp" "$pw_tmp"
  unset PASSWORD SECRET_KEY REPLY_VALUE

  set -a
  # shellcheck source=/dev/null
  source "$env_tmp"
  set +a
  export RESTIC_PASSWORD_FILE="$pw_tmp"
  if out=$(timeout 120 restic cat config 2>&1); then
    ok "Хранилище копий уже создано, пароль подходит"
  elif grep -qiE 'wrong password|no key found' <<< "$out"; then
    rm -f "$env_tmp" "$pw_tmp"
    die "Хранилище уже есть, но пароль к нему не подходит — ничего не изменено. Запустите скрипт ещё раз и введите прежний пароль."
  elif grep -qiE 'Is there a repository|does not exist|NoSuchKey|NoSuchBucket' <<< "$out"; then
    if ! out=$(timeout 300 restic init 2>&1); then
      rm -f "$env_tmp" "$pw_tmp"
      die "Не удалось создать хранилище копий: $(tail -n1 <<< "$out" | cut -c1-160). Проверьте бакет и права ключа."
    fi
    ok "Хранилище копий создано (шифрование AES-256 на этом сервере)"
  else
    rm -f "$env_tmp" "$pw_tmp"
    die "Нет доступа к хранилищу: $(tail -n1 <<< "$out" | cut -c1-160). Проверьте адрес, бакет и ключи — ничего не изменено."
  fi
  mv "$env_tmp" "$CONF_DIR/env"
  mv "$pw_tmp" "$CONF_DIR/restic-password"
  export RESTIC_PASSWORD_FILE="$CONF_DIR/restic-password"
}

install_schedule() {
  step "5/5 Расписание и первая копия"
  install -m 755 "$HERE/oneflow-backup" /usr/local/sbin/oneflow-backup
  cat > /etc/systemd/system/oneflow-backup.service <<'EOF'
[Unit]
Description=ONEFLOW encrypted off-site backup
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/oneflow-backup run
Nice=10
IOSchedulingClass=idle
EOF
  cat > /etc/systemd/system/oneflow-backup.timer <<'EOF'
[Unit]
Description=ONEFLOW backup every night

[Timer]
OnCalendar=*-*-* 02:30:00 Asia/Almaty
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  cat > /etc/systemd/system/oneflow-backup-check.service <<'EOF'
[Unit]
Description=ONEFLOW backup verification (re-reads 10% of the stored data)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/local/sbin/oneflow-backup check
Nice=10
IOSchedulingClass=idle
EOF
  cat > /etc/systemd/system/oneflow-backup-check.timer <<'EOF'
[Unit]
Description=ONEFLOW backup verification every week

[Timer]
OnCalendar=Sun *-*-* 04:00:00 Asia/Almaty
RandomizedDelaySec=10min
Persistent=true

[Install]
WantedBy=timers.target
EOF
  systemctl daemon-reload
  systemctl enable --now oneflow-backup.timer oneflow-backup-check.timer >/dev/null 2>&1
  ok "Каждую ночь в 02:30 и проверка по воскресеньям в 04:00 (время Астаны)"

  echo "    Первая копия…"
  /usr/local/sbin/oneflow-backup run | sed 's/^/    /' || die "Первая копия не получилась — пришлите скриншот."
  echo "    Проверка хранилища (перечитываю 10% данных)…"
  /usr/local/sbin/oneflow-backup check | sed 's/^/    /' || die "Проверка не прошла — пришлите скриншот."
  ok "Первая копия создана и проверена"
}

main() {
  [[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0"
  [[ -f "$APP_DIR/.env" ]] || die "Не найден $APP_DIR/.env — сначала oneflow-install.sh"
  [[ -f "$HERE/oneflow-backup" ]] || die "В пакете нет oneflow-backup — скачайте пакет заново"
  trap 'die "Ошибка в строке $LINENO. Пришлите скриншот этого окна (секретов на нём нет)."' ERR
  umask 077
  install_tools
  ask_storage
  ask_password
  open_repo
  install_schedule
  echo
  /usr/local/sbin/oneflow-backup status | sed 's/^/    /'
  printf '\n\033[1;32mГотово.\033[0m Пароль шифрования храните в менеджере паролей — он нужен для восстановления.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
