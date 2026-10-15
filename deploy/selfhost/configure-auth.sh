#!/usr/bin/env bash
# ONEFLOW — sign-in settings on the KZ server: Google sign-in, e-mail sending (SMTP), e-mail templates.
#
#   sudo bash ~/oneflow-auth/configure-auth.sh
#
# Safe to run again at any time: Enter keeps what is already set. Secrets are typed hidden, never
# echoed and never put on a command line; they live only in /opt/oneflow/supabase/.env (600 root),
# like the other server secrets.
#   1. Google: Client ID + secret → GOTRUE_EXTERNAL_GOOGLE_* (callback https://api.oneflow.art/auth/v1/callback)
#   2. SMTP: host, port, login, password, sender → SMTP_*; the login is tested before it is saved
#   3. E-mails: bilingual RU/EN templates in /srv/oneflow-mail-templates, served by Caddy at
#      /mail-templates/ for Auth to load;
#      "password / e-mail changed" notices are switched on once SMTP works
#   4. Auth restarted; checks: health, Google redirect, templates reachable, optional test e-mail

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/oneflow/supabase}"
DOMAIN="${DOMAIN:-api.oneflow.art}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TPL_DIR=/srv/oneflow-mail-templates
CADDYFILE=/etc/caddy/Caddyfile
OVERRIDE=docker-compose.auth.yml
TEMPLATES=(confirmation recovery email_change magic_link invite reauthentication password_changed email_changed)

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

clean() { local v=${1//$'\r'/}; v="${v#"${v%%[![:space:]]*}"}"; printf '%s' "${v%"${v##*[![:space:]]}"}"; }
get_env() {
  local v; v=$(grep -E "^$1=" "$APP_DIR/.env" 2>/dev/null | tail -n1 | cut -d= -f2-) || true
  v=${v#\'}; printf '%s' "${v%\'}"
}
# KEY='value' (compose takes single-quoted values literally, so "$" in a password is safe);
# the value reaches python through the environment, not argv
set_env() {
  ENV_FILE="$APP_DIR/.env" ENV_KEY="$1" ENV_VALUE="$2" python3 - <<'PY'
import os
path, key, value = os.environ["ENV_FILE"], os.environ["ENV_KEY"], os.environ["ENV_VALUE"]
line = f"{key}='{value}'"
out, done = [], False
for l in open(path, encoding="utf-8").read().splitlines():
    if l.startswith(key + "="):
        if not done:
            out.append(line)
            done = True
        continue
    out.append(l)
if not done:
    out.append(line)
tmp = path + ".tmp"
with open(tmp, "w", encoding="utf-8") as f:
    f.write("\n".join(out) + "\n")
os.chmod(tmp, 0o600)
os.replace(tmp, path)
PY
}
# a value pasted 2–5 times in a row (happens with some terminals)
repeated() {
  local v=$1 n len part i rep
  len=${#v}
  for n in 2 3 4 5; do
    (( len % n == 0 && len >= 2 * n )) || continue
    part=${v:0:len/n}; rep=""
    for (( i = 0; i < n; i++ )); do rep+=$part; done
    [[ "$rep" == "$v" ]] && return 0
  done
  return 1
}
ask_secret() {  # prompt → REPLY_SECRET
  local s
  read -r -s -p "$1" s || die "Ввод прерван"; echo
  REPLY_SECRET=$(clean "$s")
}

# ---------------------------------------------------------------------------------------------
ask_google() {
  step "1/4 Вход через Google"
  local cur_id cur_on gid
  cur_id=$(get_env GOOGLE_CLIENT_ID); cur_on=$(get_env GOOGLE_ENABLED)
  if [[ "$cur_on" == true && -n "$cur_id" ]]; then echo "    Сейчас: включён (Client ID …${cur_id: -30})"; else echo "    Сейчас: выключен"; fi
  echo "    Client ID и Client secret — из Google Cloud Console → Credentials → OAuth client."
  G_CHANGED=0
  while true; do
    read -r -p "    Client ID (Enter — оставить как есть, «-» — выключить Google): " gid || die "Ввод прерван"
    gid=$(clean "$gid")
    if [[ -z "$gid" ]]; then
      [[ "$cur_on" == true ]] && ok "Google без изменений" || warn "Google не настроен — пропускаю"
      return 0
    fi
    if [[ "$gid" == "-" ]]; then
      G_ENABLED=false; G_CHANGED=1; warn "Google будет выключен"; return 0
    fi
    if repeated "$gid"; then warn "Похоже, ID вставлен несколько раз подряд. Вставьте один раз."; continue; fi
    [[ "$gid" =~ ^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$ ]] && break
    warn "Не похоже на Client ID (вида 1234567890-abc….apps.googleusercontent.com). Скопируйте ещё раз."
  done
  G_ID=$gid
  while true; do
    if [[ "$gid" == "$cur_id" && -n "$(get_env GOOGLE_SECRET)" ]]; then
      ask_secret "    Client secret (ввод скрыт; Enter — оставить сохранённый): "
      [[ -z "$REPLY_SECRET" ]] && { G_SECRET=$(get_env GOOGLE_SECRET); break; }
    else
      ask_secret "    Client secret (ввод скрыт): "
      [[ -z "$REPLY_SECRET" ]] && { warn "Нужен Client secret."; continue; }
    fi
    if repeated "$REPLY_SECRET"; then warn "Похоже, секрет вставлен несколько раз подряд. Вставьте один раз."; continue; fi
    [[ "$REPLY_SECRET" == *"'"* ]] && { warn "В секрете не может быть апострофа — скопируйте ещё раз."; continue; }
    if [[ "$REPLY_SECRET" =~ ^GOCSPX-[A-Za-z0-9_-]{20,}$ ]]; then G_SECRET=$REPLY_SECRET; break; fi
    if [[ "$REPLY_SECRET" =~ ^[A-Za-z0-9_-]{20,}$ ]]; then
      warn "Секрет не начинается с GOCSPX- (бывает у старых клиентов) — принимаю."
      G_SECRET=$REPLY_SECRET; break
    fi
    warn "Не похоже на Client secret (обычно начинается с GOCSPX-). Скопируйте ещё раз."
  done
  G_ENABLED=true; G_CHANGED=1
  ok "Google: Client ID принят, секрет сохранён скрыто"
}

smtp_test() {  # host port user  (password in SMTP_TEST_PASS) → prints ok|auth|net:…|tls:…|notls
  SMTP_TEST_HOST="$1" SMTP_TEST_PORT="$2" SMTP_TEST_USER="$3" python3 - <<'PY'
import os, smtplib, socket, ssl, sys
h, p, u, pw = os.environ["SMTP_TEST_HOST"], int(os.environ["SMTP_TEST_PORT"]), os.environ["SMTP_TEST_USER"], os.environ["SMTP_TEST_PASS"]
ctx = ssl.create_default_context()
try:
    if p == 465:
        s = smtplib.SMTP_SSL(h, p, timeout=20, context=ctx)
    else:
        s = smtplib.SMTP(h, p, timeout=20)
        s.ehlo()
        if not s.has_extn("starttls"):
            print("notls"); sys.exit(0)
        s.starttls(context=ctx)
        s.ehlo()
    s.login(u, pw)
    s.quit()
    print("ok")
except smtplib.SMTPAuthenticationError:
    print("auth")
except ssl.SSLCertVerificationError as e:
    print("cert:" + (e.verify_message or "")[:80])
except ssl.SSLError as e:
    print("tls:" + str(e)[:80])
except (OSError, smtplib.SMTPException) as e:
    print("net:" + type(e).__name__)
PY
}

ask_smtp() {
  step "2/4 Отправка писем (SMTP)"
  local cur_host host port user pass from name res cur_pass
  cur_host=$(get_env SMTP_HOST)
  if [[ -n "$cur_host" && "$cur_host" != supabase-mail ]]; then
    echo "    Сейчас: $cur_host:$(get_env SMTP_PORT), отправитель $(get_env SMTP_ADMIN_EMAIL)"
  else
    echo "    Сейчас: не настроена (письма о подтверждении и сбросе пароля не уходят)"
  fi
  S_CHANGED=0
  while true; do
    read -r -p "    SMTP-сервер, например mail.oneflow.art (Enter — оставить как есть): " host || die "Ввод прерван"
    host=$(clean "$host")
    if [[ -z "$host" ]]; then ok "SMTP без изменений"; return 0; fi
    [[ "$host" =~ ^[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] && break
    warn "Не похоже на адрес сервера. Скопируйте из письма поддержки."
  done
  while true; do
    read -r -p "    Порт (Enter — 465): " port || die "Ввод прерван"; port=$(clean "$port"); port=${port:-465}
    [[ "$port" =~ ^(465|587|2525|25)$ ]] && break
    warn "Обычно 465 (SSL) или 587 (STARTTLS)."
  done
  while true; do
    read -r -p "    Логин (обычно полный адрес ящика; Enter — noreply@oneflow.art): " user || die "Ввод прерван"
    user=$(clean "$user"); user=${user:-noreply@oneflow.art}
    [[ "$user" =~ ^[^[:space:]\']+$ ]] && break
    warn "Логин без пробелов и апострофов."
  done
  cur_pass=$(get_env SMTP_PASS)
  while true; do
    if [[ "$host" == "$cur_host" && "$user" == "$(get_env SMTP_USER)" && -n "$cur_pass" && "$cur_pass" != fake_mail_password ]]; then
      ask_secret "    Пароль ящика (ввод скрыт; Enter — оставить сохранённый): "
      [[ -z "$REPLY_SECRET" ]] && { pass=$cur_pass; break; }
    else
      ask_secret "    Пароль ящика (ввод скрыт): "
      [[ -z "$REPLY_SECRET" ]] && { warn "Нужен пароль."; continue; }
    fi
    if repeated "$REPLY_SECRET" && (( ${#REPLY_SECRET} >= 16 )); then warn "Похоже, пароль вставлен несколько раз подряд. Вставьте один раз."; continue; fi
    [[ "$REPLY_SECRET" == *"'"* ]] && { warn "Пароль с апострофом (') не поддерживается — смените его в почте и введите снова."; continue; }
    pass=$REPLY_SECRET; break
  done
  [[ "$user" == *@* ]] && from=$user || from=noreply@oneflow.art
  read -r -p "    Адрес отправителя (Enter — $from): " res || die "Ввод прерван"; res=$(clean "$res"); from=${res:-$from}
  [[ "$from" =~ ^[^[:space:]@\']+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || die "Адрес отправителя не похож на email"
  read -r -p "    Имя отправителя (Enter — ONEFLOW): " name || die "Ввод прерван"; name=$(clean "$name"); name=${name:-ONEFLOW}
  [[ "$name" == *"'"* ]] && die "Имя отправителя без апострофов"

  echo "    Проверяю вход на $host:$port …"
  res=$(SMTP_TEST_PASS="$pass" smtp_test "$host" "$port" "$user")
  case "$res" in
    ok)     ok "Сервер принял логин и пароль" ;;
    auth)   die "Сервер отклонил логин или пароль. Ничего не сохранено — запустите скрипт ещё раз." ;;
    cert:*) die "Сертификат сервера не подходит к адресу $host (${res#cert:}). Возьмите точное имя SMTP-сервера из письма поддержки (часто вида mail.<провайдер>.kz). Ничего не сохранено." ;;
    tls:*)  die "Ошибка шифрования (${res#tls:}). Попробуйте порт 587. Ничего не сохранено." ;;
    notls)  die "Сервер на порту $port не поддерживает шифрование — без него пароль ушёл бы открытым текстом. Используйте 465 или 587. Ничего не сохранено." ;;
    *)      die "Нет соединения с $host:$port (${res#net:}). Возможно, провайдер сервера закрыл исходящий порт — спросите в SmartCloud, или попробуйте 587. Ничего не сохранено." ;;
  esac
  S_HOST=$host; S_PORT=$port; S_USER=$user; S_PASS=$pass; S_FROM=$from; S_NAME=$name; S_CHANGED=1
}

# ---------------------------------------------------------------------------------------------
save_settings() {
  if (( G_CHANGED )); then
    set_env GOOGLE_ENABLED "$G_ENABLED"
    if [[ "$G_ENABLED" == true ]]; then
      set_env GOOGLE_CLIENT_ID "$G_ID"
      set_env GOOGLE_SECRET "$G_SECRET"
    fi
  fi
  if (( S_CHANGED )); then
    set_env SMTP_HOST "$S_HOST"; set_env SMTP_PORT "$S_PORT"; set_env SMTP_USER "$S_USER"
    set_env SMTP_PASS "$S_PASS"; set_env SMTP_ADMIN_EMAIL "$S_FROM"; set_env SMTP_SENDER_NAME "$S_NAME"
    set_env ONEFLOW_MAIL_NOTIFICATIONS true
  fi
  unset G_SECRET S_PASS REPLY_SECRET
}

install_templates() {
  step "3/4 Шаблоны писем (русский + английский)"
  local t
  install -d -m 755 "$TPL_DIR"
  for t in "${TEMPLATES[@]}"; do
    [[ -f "$HERE/mail-templates/$t.html" ]] || die "В пакете нет mail-templates/$t.html — скачайте пакет заново"
    install -m 644 "$HERE/mail-templates/$t.html" "$TPL_DIR/$t.html"
  done
  ok "Шаблоны: $TPL_DIR (${#TEMPLATES[@]} писем)"

  if ! grep -q '/mail-templates/\*' "$CADDYFILE"; then
    local backup; backup="$CADDYFILE.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$CADDYFILE" "$backup"
    python3 - "$CADDYFILE" <<'PY' || { cp "$backup" "$CADDYFILE"; die "В $CADDYFILE не нашлось блока «handle {» от oneflow-install.sh — ничего не изменено. Пришлите скриншот."; }
import sys
path = sys.argv[1]
lines = open(path, encoding="utf-8").read().split("\n")
try:
    i = lines.index("\thandle {")          # the catch-all "Not found" of oneflow-install.sh
except ValueError:
    sys.exit("catch-all not found")
block = [
    "\t# e-mail templates that Auth loads (configure-auth.sh): static files, no listing, no secrets",
    "\thandle_path /mail-templates/* {",
    "\t\troot * /srv/oneflow-mail-templates",
    "\t\tfile_server",
    "\t}",
]
lines[i:i] = block
open(path, "w", encoding="utf-8").write("\n".join(lines))
PY
    if ! caddy validate --config "$CADDYFILE" --adapter caddyfile >/dev/null 2>&1; then
      cp "$backup" "$CADDYFILE"
      die "Новая настройка Caddy не прошла проверку — вернул прежнюю. Пришлите скриншот."
    fi
    systemctl reload caddy
    ok "Caddy отдаёт шаблоны по адресу https://$DOMAIN/mail-templates/ (копия прежней настройки: $backup)"
  fi
  local code i
  for i in 1 2 3 4 5; do
    code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/mail-templates/confirmation.html")
    [[ "$code" == 200 ]] && break; sleep 2
  done
  [[ "$code" == 200 ]] || die "Шаблон не открывается по https://$DOMAIN/mail-templates/confirmation.html (HTTP $code)"
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$DOMAIN/mail-templates/")
  [[ "$code" == 404 ]] || die "Список шаблонов открыт (HTTP $code), а должен быть 404"
  ok "Шаблоны доступны, список файлов закрыт"
}

write_override() {
  local base="https://$DOMAIN/mail-templates"
  cat > "$APP_DIR/$OVERRIDE" <<EOF
# ONEFLOW: sign-in providers and e-mails — written by configure-auth.sh; the values live in .env
services:
  auth:
    environment:
      GOTRUE_EXTERNAL_GOOGLE_ENABLED: \${GOOGLE_ENABLED:-false}
      GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID: \${GOOGLE_CLIENT_ID:-}
      GOTRUE_EXTERNAL_GOOGLE_SECRET: \${GOOGLE_SECRET:-}
      GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI: https://$DOMAIN/auth/v1/callback
      GOTRUE_MAILER_TEMPLATES_CONFIRMATION: $base/confirmation.html
      GOTRUE_MAILER_TEMPLATES_RECOVERY: $base/recovery.html
      GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE: $base/email_change.html
      GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: $base/magic_link.html
      GOTRUE_MAILER_TEMPLATES_INVITE: $base/invite.html
      GOTRUE_MAILER_TEMPLATES_REAUTHENTICATION: $base/reauthentication.html
      GOTRUE_MAILER_TEMPLATES_PASSWORD_CHANGED_NOTIFICATION: $base/password_changed.html
      GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGED_NOTIFICATION: $base/email_changed.html
      GOTRUE_MAILER_SUBJECTS_CONFIRMATION: "Подтвердите email · Confirm your email — ONEFLOW"
      GOTRUE_MAILER_SUBJECTS_RECOVERY: "Сброс пароля · Reset your password — ONEFLOW"
      GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE: "Подтвердите новый email · Confirm your new email — ONEFLOW"
      GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: "Вход в ONEFLOW · Sign in to ONEFLOW"
      GOTRUE_MAILER_SUBJECTS_INVITE: "Приглашение в ONEFLOW · You're invited to ONEFLOW"
      GOTRUE_MAILER_SUBJECTS_REAUTHENTICATION: "Код подтверждения · Confirmation code — ONEFLOW"
      GOTRUE_MAILER_SUBJECTS_PASSWORD_CHANGED_NOTIFICATION: "Пароль изменён · Your password was changed — ONEFLOW"
      GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGED_NOTIFICATION: "Email аккаунта изменён · Your account email was changed — ONEFLOW"
      # security notices go out only once SMTP is set up (configure-auth.sh turns this on)
      GOTRUE_MAILER_NOTIFICATIONS_PASSWORD_CHANGED_ENABLED: \${ONEFLOW_MAIL_NOTIFICATIONS:-false}
      GOTRUE_MAILER_NOTIFICATIONS_EMAIL_CHANGED_ENABLED: \${ONEFLOW_MAIL_NOTIFICATIONS:-false}
EOF
  chmod 644 "$APP_DIR/$OVERRIDE"
  local cf; cf=$(grep -E '^COMPOSE_FILE=' "$APP_DIR/.env" | tail -n1 | cut -d= -f2-)
  [[ -n "$cf" ]] || cf=docker-compose.yml
  if [[ ":$cf:" != *":$OVERRIDE:"* ]]; then
    sed -i "s|^COMPOSE_FILE=.*|COMPOSE_FILE=$cf:$OVERRIDE|" "$APP_DIR/.env"
  fi
  (cd "$APP_DIR" && docker compose config -q) || die "Ошибка в настройке docker compose. Пришлите скриншот."
}

restart_and_check() {
  step "4/4 Перезапуск входа и проверки"
  (cd "$APP_DIR" && docker compose up -d --no-deps --force-recreate auth >/dev/null 2>&1) \
    || die "Сервис входа не перезапустился. Пришлите вывод: cd $APP_DIR && sudo docker compose ps"
  local anon i settings loc
  anon=$(get_env ANON_KEY)
  for i in $(seq 1 30); do
    curl -fsS -o /dev/null -H "apikey: $anon" "https://$DOMAIN/auth/v1/health" 2>/dev/null && break
    [[ $i -eq 30 ]] && die "Сервис входа не отвечает после перезапуска. Пришлите вывод: cd $APP_DIR && sudo docker compose logs --tail 30 auth"
    sleep 3
  done
  ok "Сервис входа работает"

  settings=$(curl -fsS -H "apikey: $anon" "https://$DOMAIN/auth/v1/settings")
  if [[ "$(get_env GOOGLE_ENABLED)" == true ]]; then
    python3 -c 'import json,sys; sys.exit(0 if json.load(sys.stdin)["external"].get("google") else 1)' <<< "$settings" \
      || die "Google не включился. Пришлите вывод: cd $APP_DIR && sudo docker compose logs --tail 30 auth"
    loc=$(curl -s -o /dev/null -w '%{redirect_url}' -H "apikey: $anon" \
      "https://$DOMAIN/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Foneflow.art%2Fapp")
    [[ "$loc" == https://accounts.google.com/* && "$loc" == *"redirect_uri=https%3A%2F%2F${DOMAIN}%2Fauth%2Fv1%2Fcallback"* ]] \
      || die "Переход на Google не тот, что ожидался. Пришлите скриншот."
    ok "Google включён: кнопка входа ведёт на Google с возвратом на https://$DOMAIN/auth/v1/callback"
  else
    ok "Google выключен"
  fi
  python3 -c 'import json,sys; sys.exit(0 if not json.load(sys.stdin).get("mailer_autoconfirm") else 1)' <<< "$settings" \
    && ok "Регистрация по email — с подтверждением адреса"

  local smtp; smtp=$(get_env SMTP_HOST)
  if [[ -z "$smtp" || "$smtp" == supabase-mail ]]; then
    warn "Почта ещё не настроена: письма о подтверждении и сбросе пароля не уйдут. Запустите скрипт снова, когда будут данные SMTP."
    return 0
  fi
  local to code body out
  read -r -p "    Тестовое письмо: email ВАШЕГО аккаунта ONEFLOW (Enter — пропустить): " to || to=""
  to=$(clean "$to")
  [[ -z "$to" ]] && return 0
  [[ "$to" =~ ^[^[:space:]@\"]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$ ]] || { warn "Не похоже на email — пропускаю тест"; return 0; }
  body=$(python3 -c 'import json,sys; print(json.dumps({"email": sys.argv[1], "create_user": False}))' "$to")
  out=$(mktemp)
  code=$(curl -s -o "$out" -w '%{http_code}' -H "apikey: $anon" -H "Content-Type: application/json" \
    --data "$body" "https://$DOMAIN/auth/v1/otp")
  if [[ "$code" == 200 ]]; then
    ok "Письмо «Вход в ONEFLOW» отправлено на $to — проверьте «Входящие» и «Спам»"
  else
    warn "Письмо не ушло (HTTP $code): $(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("msg") or d.get("error_description") or d.get("error_code") or "")' "$out" 2>/dev/null | cut -c1-120)"
    warn "Подробности: cd $APP_DIR && sudo docker compose logs --tail 20 auth | grep -i mail"
  fi
  rm -f "$out"
}

main() {
  [[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0"
  [[ -f "$APP_DIR/.env" ]] && grep -q '^# oneflow-configured' "$APP_DIR/.env" || die "Сначала выполните oneflow-install.sh"
  command -v caddy >/dev/null || die "Caddy не найден — сначала выполните oneflow-install.sh"
  trap 'die "Ошибка в строке $LINENO. Пришлите скриншот этого окна (секретов на нём нет)."' ERR
  umask 077
  G_CHANGED=0; S_CHANGED=0
  ask_google
  ask_smtp
  save_settings
  install_templates
  write_override
  restart_and_check
  printf '\n\033[1;32mГотово.\033[0m Рабочий сайт это не затронуло — он по-прежнему на старом Supabase.\n'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
