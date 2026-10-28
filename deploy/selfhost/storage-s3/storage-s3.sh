#!/usr/bin/env bash
# ONEFLOW — moves the server's file storage (videos, banners, kept generations) to an S3 bucket
# (megahost), so the files live there instead of on the server disk. The app keeps working through
# https://api.oneflow.art: the storage service itself reads and writes the bucket.
#
#   sudo bash ~/oneflow-storage-s3/storage-s3.sh             check, copy, switch after «да»
#   sudo bash ~/oneflow-storage-s3/storage-s3.sh --rollback  back to the disk, bringing back what was saved in S3 meanwhile
#   sudo bash ~/oneflow-storage-s3/storage-s3.sh --keys      new bucket keys (after «Сменить ключи» at the provider)
#
# 1. Asks the bucket address, name, region and keys (the secret is typed hidden, kept root-only in
#    /opt/oneflow/supabase/storage-s3.env); checks the bucket: write, read, delete, and that it does
#    not open without the key.
# 2. Copies every stored file to the bucket under the path the storage service uses there
#    (<tenant>/<bucket>/<name>/<version>, the same as under volumes/storage/<dir>/ on the disk),
#    with its type; files already there are skipped. The files on the disk stay: they are the way back.
# 3. Only after «да»: copies what came in meanwhile, switches the storage service to the bucket,
#    copies the last seconds, then checks through https://api.oneflow.art that files open and match
#    the disk copies byte for byte, and that a new file lands in the bucket. If a check fails, it
#    switches back to the disk by itself.

set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/oneflow/supabase}"
DOMAIN="${DOMAIN:-api.oneflow.art}"
DB_CONTAINER="${DB_CONTAINER:-supabase-db}"
ST_CONTAINER="${ST_CONTAINER:-supabase-storage}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OVERRIDE=docker-compose.storage-s3.yml
KEYS_FILE="$APP_DIR/storage-s3.env"
CONF_FILE="$APP_DIR/storage-s3.conf"
DEF_ENDPOINT=https://s3akt.megahost.cloud
DEF_BUCKET=oneflow-files
DEF_REGION=kz-aktau

step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
ok()   { printf '\033[1;32m    ✓ %s\033[0m\n' "$*"; }
bad()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*"; FAILS=$(( ${FAILS:-0} + 1 )); }
warn() { printf '\033[1;33m    ! %s\033[0m\n' "$*"; }
info() { printf '    · %s\n' "$*"; }
die()  { printf '\033[1;31m    ✗ %s\033[0m\n' "$*" >&2; exit 1; }

env_value() { local v; v=$(grep -E "^$2=" "$1" 2>/dev/null | tail -n1 | cut -d= -f2-) || true; v=${v#\'}; printf '%s' "${v%\'}"; }
clean() { local v=${1//$'\r'/}; v="${v#"${v%%[![:space:]]*}"}"; printf '%s' "${v%"${v##*[![:space:]]}"}"; }

set_env() {
  local key=$1 value=$2 file=${3:-$APP_DIR/.env} escaped
  escaped=$(printf '%s' "$value" | sed -e 's/[\\|&]/\\&/g')
  if grep -qE "^${key}=" "$file"; then
    sed -i "s|^${key}=.*|${key}=${escaped}|" "$file"
  else
    printf '%s=%s\n' "$key" "$value" >> "$file"
  fi
}
compose_files_add() {
  local current; current=$(env_value "$APP_DIR/.env" COMPOSE_FILE)
  [[ -n "$current" ]] || current="docker-compose.yml"
  case ":$current:" in *":$1:"*) return ;; esac
  set_env COMPOSE_FILE "$current:$1"
}
compose_files_remove() {
  local current; current=$(env_value "$APP_DIR/.env" COMPOSE_FILE)
  case ":$current:" in *":$1:"*) ;; *) return ;; esac
  current=":$current:"; current=${current//:$1:/:}; current=${current#:}; current=${current%:}
  set_env COMPOSE_FILE "${current:-docker-compose.yml}"
}

# psql as the database superuser inside the db container; the password goes by name.
q() {
  PGPASSWORD=$(env_value "$APP_DIR/.env" POSTGRES_PASSWORD) \
    docker exec -e PGPASSWORD "$DB_CONTAINER" psql -U supabase_admin -h 127.0.0.1 -d postgres -X -q -v ON_ERROR_STOP=1 -At "$@"
}
TMPD=$(mktemp -d); trap 'rm -rf "$TMPD"' EXIT

[[ $EUID -eq 0 ]] || die "Запустите через sudo: sudo bash $0"
[[ -f "$APP_DIR/.env" ]] || die "Нет $APP_DIR/.env — это не сервер ONEFLOW?"
(cd "$HERE" && sha256sum -c --quiet SHA256SUMS) || die "Пакет повреждён — скачайте oneflow-storage-s3.tar.gz заново"
for c in docker curl python3 sha256sum; do command -v "$c" >/dev/null || die "Не найдено: $c"; done
curl --help all 2>/dev/null | grep -q -- '--aws-sigv4' || die "curl на сервере слишком старый (нужен --aws-sigv4)"

TENANT=$(env_value "$APP_DIR/.env" STORAGE_TENANT_ID); TENANT=${TENANT:-stub}
DISK_DIR=$(env_value "$APP_DIR/.env" GLOBAL_S3_BUCKET); DISK_DIR=${DISK_DIR:-stub}
DISK_ROOT="$APP_DIR/volumes/storage/$DISK_DIR"   # the file backend keeps <tenant>/<bucket>/<name>/<version> here
[[ -d "$DISK_ROOT" ]] || die "Нет папки хранилища $DISK_ROOT"

backend_now() { docker exec "$ST_CONTAINER" printenv STORAGE_BACKEND 2>/dev/null || echo "?"; }

# ---------------------------------------------------------------------------------------------
# S3 requests signed with the bucket keys (AWS Signature v4); the keys go to curl through a config
# on a pipe, never on the command line.
creds() { printf 'user = "%s:%s"\n' "$AK" "$SK"; }
urlkey() { python3 -I -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe="/-_.~"))' "$1"; }
s3() {  # s3 METHOD KEY [curl args] → HTTP code; body in $TMPD/s3.body
  local method=$1 key=$2 how; shift 2
  [[ "$method" == HEAD ]] && how=(-I) || how=(-X "$method")
  curl -sS -m 900 -o "$TMPD/s3.body" -w '%{http_code}' "${how[@]}" --aws-sigv4 "aws:amz:$S3_REGION:s3" -K <(creds) \
    "$@" "$S3_ENDPOINT/$S3_BUCKET/$(urlkey "$key")" 2>"$TMPD/s3.err" || echo 000
}
s3_why() { { head -c 300 "$TMPD/s3.body"; head -c 200 "$TMPD/s3.err"; } 2>/dev/null | tr -s '\n' ' '; }

ask_s3() {
  step "Бакет S3"
  local v cur_key
  S3_ENDPOINT=$(env_value "$CONF_FILE" S3_ENDPOINT); S3_ENDPOINT=${S3_ENDPOINT:-$DEF_ENDPOINT}
  S3_BUCKET=$(env_value "$CONF_FILE" S3_BUCKET); S3_BUCKET=${S3_BUCKET:-$DEF_BUCKET}
  S3_REGION=$(env_value "$CONF_FILE" S3_REGION); S3_REGION=${S3_REGION:-$DEF_REGION}
  read -r -p "    Адрес (Enter — $S3_ENDPOINT): " v || v=""; v=$(clean "$v"); S3_ENDPOINT=${v:-$S3_ENDPOINT}; S3_ENDPOINT=${S3_ENDPOINT%/}
  [[ "$S3_ENDPOINT" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?$ ]] || die "Адрес должен быть вида https://… — только https"
  read -r -p "    Бакет (Enter — $S3_BUCKET): " v || v=""; v=$(clean "$v"); S3_BUCKET=${v:-$S3_BUCKET}
  [[ "$S3_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]] || die "Имя бакета: строчные латинские буквы, цифры, точка и дефис"
  read -r -p "    Регион (Enter — $S3_REGION): " v || v=""; v=$(clean "$v"); S3_REGION=${v:-$S3_REGION}
  [[ "$S3_REGION" =~ ^[A-Za-z0-9-]+$ ]] || die "Регион: латинские буквы, цифры и дефис"
  ask_keys keep
  ok "$S3_ENDPOINT, бакет $S3_BUCKET, регион $S3_REGION"
}

# The bucket keys, both typed hidden (they must not end up on a screenshot); only the last four
# characters of the key id are shown back. $1 = keep: Enter keeps the saved ones; new: no default.
ask_keys() {
  local v cur_key=""
  [[ "$1" == keep ]] && cur_key=$(env_value "$KEYS_FILE" AWS_ACCESS_KEY_ID)
  read -r -s -p "    Идентификатор ключа (ввод скрыт${cur_key:+; Enter — оставить сохранённый}): " v || v=""; echo
  v=$(clean "$v"); AK=${v:-$cur_key}
  [[ -n "$AK" ]] || die "Нужен идентификатор ключа (из личного кабинета S3, страница «Доступы»)"
  [[ "$AK" =~ ^[A-Za-z0-9]{8,128}$ ]] || die "Идентификатор ключа: латинские буквы и цифры"
  if [[ -n "$cur_key" && "$AK" == "$cur_key" ]]; then
    read -r -s -p "    Секретный ключ (ввод скрыт; Enter — оставить сохранённый): " v || v=""; echo
    v=$(clean "$v"); SK=${v:-$(env_value "$KEYS_FILE" AWS_SECRET_ACCESS_KEY)}
  else
    read -r -s -p "    Секретный ключ (ввод скрыт): " v || v=""; echo
    SK=$(clean "$v")
  fi
  [[ "$SK" =~ ^[A-Za-z0-9/+=]{16,128}$ ]] || die "Секретный ключ не похож на ключ S3 — вставьте его ещё раз (только сам ключ)"
  ok "ключ …${AK: -4} принят"
}

load_saved() {
  AK=$(env_value "$KEYS_FILE" AWS_ACCESS_KEY_ID); SK=$(env_value "$KEYS_FILE" AWS_SECRET_ACCESS_KEY)
  S3_ENDPOINT=$(env_value "$CONF_FILE" S3_ENDPOINT); S3_BUCKET=$(env_value "$CONF_FILE" S3_BUCKET); S3_REGION=$(env_value "$CONF_FILE" S3_REGION)
  [[ -n "$AK" && -n "$SK" && -n "$S3_BUCKET" ]] || die "Нет сохранённых настроек бакета ($KEYS_FILE, $CONF_FILE)"
}
write_keys() {
  install -m 600 -o root -g root /dev/null "$KEYS_FILE"
  printf "# ONEFLOW: keys of the S3 bucket for the storage service — written by storage-s3.sh. root only; never copy.\nAWS_ACCESS_KEY_ID='%s'\nAWS_SECRET_ACCESS_KEY='%s'\n" "$AK" "$SK" > "$KEYS_FILE"
}

check_bucket() {
  step "Проверка бакета (пробный файл, сразу удаляется)"
  local key code
  key="_oneflow_check/$(cat /proc/sys/kernel/random/uuid).txt"
  printf 'oneflow' > "$TMPD/probe"
  code=$(s3 PUT "$key" -T "$TMPD/probe" -H 'Content-Type: text/plain')
  [[ "$code" == 200 ]] || die "запись в бакет: HTTP $code $(s3_why) — проверьте адрес, бакет, регион и ключи"
  ok "запись"
  code=$(s3 GET "$key")
  [[ "$code" == 200 && "$(cat "$TMPD/s3.body")" == oneflow ]] || die "чтение из бакета: HTTP $code $(s3_why)"
  ok "чтение"
  code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "$S3_ENDPOINT/$S3_BUCKET/$(urlkey "$key")" || echo 000)
  [[ "$code" != 200 ]] && ok "без ключа файл не открывается (HTTP $code) — бакет закрытый" \
    || die "файл открывается без ключа — сделайте бакет закрытым (private) в личном кабинете и запустите снова"
  code=$(s3 DELETE "$key")
  [[ "$code" =~ ^20[04]$ ]] || die "удаление из бакета: HTTP $code $(s3_why)"
  ok "удаление"
}

# Every live object the storage service knows (storage.objects): where it is on the disk, its key
# in the bucket, its type and cache header. Tab-separated; object names never contain tabs.
list_objects() {
  q -F $'\t' -c "select bucket_id, name, coalesce(version, ''), coalesce(metadata->>'mimetype', ''), coalesce(metadata->>'cacheControl', '')
                   from storage.objects order by created_at" |
    python3 -I -c '
import sys
tenant, root = sys.argv[1], sys.argv[2]
for line in sys.stdin:
    parts = line.rstrip("\n").split("\t")
    if len(parts) != 5:
        continue
    bucket, name, version, ctype, cache = parts
    key = f"{tenant}/{bucket}/{name}" + (f"/{version}" if version else "")
    print("\t".join([f"{root}/{key}", key, ctype or "application/octet-stream", cache or "no-cache", bucket, name]))
' "$TENANT" "$DISK_ROOT"
}

# Copies to the bucket what is on the disk and not yet there. $1 = label for the summary.
copy_to_s3() {
  local label=$1 file key ctype cache _b _n code total=0 copied=0 had=0 nodisk=0 failed=0
  list_objects > "$TMPD/objects.tsv"
  while IFS=$'\t' read -r file key ctype cache _b _n; do
    total=$((total + 1))
    if [[ ! -f "$file" ]]; then nodisk=$((nodisk + 1)); continue; fi
    code=$(s3 HEAD "$key")
    if [[ "$code" == 200 ]]; then had=$((had + 1)); continue; fi
    code=$(s3 PUT "$key" -T "$file" -H "Content-Type: $ctype" -H "Cache-Control: $cache")
    if [[ "$code" == 200 ]]; then copied=$((copied + 1)); else failed=$((failed + 1)); bad "$key: HTTP $code $(s3_why)"; fi
  done < "$TMPD/objects.tsv"
  info "$label: файлов $total, скопировано $copied, уже были в бакете $had$( ((nodisk)) && echo ", нет на диске $nodisk")"
  [[ $nodisk -eq 0 ]] || warn "файлы, которых нет на диске, были потеряны раньше — их и сейчас нельзя открыть"
  [[ $failed -eq 0 ]] || return 1
}

# Brings back to the disk what exists only in the bucket (made while the storage was on S3), with
# the type the disk storage reads from the file attributes.
restore_from_s3() {
  local file key ctype cache _b _n code restored=0 lost=0 failed=0 owner
  command -v setfattr >/dev/null || apt-get install -y -qq attr >/dev/null 2>&1 || die "Не удалось установить attr (setfattr)"
  owner=$(stat -c '%u:%g' "$DISK_ROOT")
  list_objects > "$TMPD/objects.tsv"
  while IFS=$'\t' read -r file key ctype cache _b _n; do
    [[ -f "$file" ]] && continue
    code=$(s3 GET "$key")
    if [[ "$code" == 404 ]]; then lost=$((lost + 1)); continue; fi   # lost before the move: neither on the disk nor in the bucket
    if [[ "$code" != 200 ]]; then failed=$((failed + 1)); bad "$key: из бакета не скачался (HTTP $code)"; continue; fi
    mkdir -p "$(dirname "$file")"
    install -m 644 -o "${owner%%:*}" -g "${owner##*:}" "$TMPD/s3.body" "$file"
    setfattr -n user.supabase.content-type -v "$ctype" "$file"
    setfattr -n user.supabase.cache-control -v "$cache" "$file"
    restored=$((restored + 1))
  done < "$TMPD/objects.tsv"
  info "возвращено на диск файлов, сохранённых в бакете: $restored"
  ((lost == 0)) || warn "файлов нет ни на диске, ни в бакете (потеряны ещё до переноса): $lost"
  [[ $failed -eq 0 ]]
}

wait_storage() {
  local i state
  for i in $(seq 1 45); do
    state=$(docker inspect -f '{{.State.Health.Status}}' "$ST_CONTAINER" 2>/dev/null || true)
    [[ "$state" == healthy ]] && return 0
    sleep 2
  done
  return 1
}
restart_storage() {
  cd "$APP_DIR"
  docker compose config --format json >/dev/null || die "docker compose не принял настройки"
  docker compose up -d --force-recreate --no-deps storage >/dev/null 2>&1
  wait_storage || { docker compose logs --tail 20 storage | sed 's/^/    /'; return 1; }
}

switch_to_s3() {
  write_keys
  printf "S3_ENDPOINT='%s'\nS3_BUCKET='%s'\nS3_REGION='%s'\n" "$S3_ENDPOINT" "$S3_BUCKET" "$S3_REGION" > "$CONF_FILE"
  cat > "$APP_DIR/$OVERRIDE" <<EOF
# ONEFLOW: the storage service keeps the files in the S3 bucket (storage-s3.sh; back: --rollback).
services:
  storage:
    env_file:
      - ./storage-s3.env
    environment:
      STORAGE_BACKEND: s3
      GLOBAL_S3_BUCKET: $S3_BUCKET
      GLOBAL_S3_ENDPOINT: $S3_ENDPOINT
      GLOBAL_S3_PROTOCOL: https
      GLOBAL_S3_FORCE_PATH_STYLE: "true"
      STORAGE_S3_REGION: $S3_REGION
EOF
  compose_files_add "$OVERRIDE"
  restart_storage
}
switch_to_disk() {
  compose_files_remove "$OVERRIDE"
  restart_storage
}

# Through https://api.oneflow.art with the service key, like the app: the latest files open and are
# the same bytes as on the disk; a new file lands in the bucket (when on S3) and goes away again.
verify() {
  local where=$1 srk file key ctype cache bucket name code n=0 path probe ver
  FAILS=0
  srk=$(env_value "$APP_DIR/.env" SERVICE_ROLE_KEY)
  svc() { printf 'header = "apikey: %s"\nheader = "Authorization: Bearer %s"\n' "$srk" "$srk"; }
  list_objects | tail -n 40 > "$TMPD/recent.tsv"
  while IFS=$'\t' read -r file key ctype cache bucket name; do
    [[ -f "$file" && $n -lt 8 ]] || continue
    n=$((n + 1))
    code=$(curl -s -m 120 -o "$TMPD/got" -w '%{http_code}' -K <(svc) "https://$DOMAIN/storage/v1/object/authenticated/$bucket/$(urlkey "$name")" || echo 000)
    if [[ "$code" == 200 && "$(sha256sum < "$TMPD/got")" == "$(sha256sum < "$file")" ]]; then ok "$bucket/$name — открывается, совпадает с оригиналом"
    else bad "$bucket/$name — HTTP $code или содержимое другое"; fi
  done < "$TMPD/recent.tsv"
  [[ $n -gt 0 ]] || info "файлов для сверки пока нет"

  path="_check/$(cat /proc/sys/kernel/random/uuid).png"
  printf '%s' 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' | base64 -d > "$TMPD/probe.png"
  code=$(curl -s -m 60 -o "$TMPD/up" -w '%{http_code}' -K <(svc) -H 'Content-Type: image/png' --data-binary "@$TMPD/probe.png" "https://$DOMAIN/storage/v1/object/ai-generated-videos/$path" || echo 000)
  if [[ "$code" != 200 ]]; then bad "новый файл не сохранился: HTTP $code $(head -c 160 "$TMPD/up")"; return; fi
  ok "новый файл сохраняется"
  if [[ "$where" == s3 ]]; then
    ver=$(q -c "select coalesce(version, '') from storage.objects where bucket_id = 'ai-generated-videos' and name = '$path'")
    probe="$TENANT/ai-generated-videos/$path${ver:+/$ver}"
    [[ "$(s3 HEAD "$probe")" == 200 ]] && ok "и лежит в бакете S3, а не на диске" || bad "новый файл не найден в бакете S3"
  fi
  code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' "https://$DOMAIN/storage/v1/object/public/ai-generated-videos/$path" || echo 000)
  [[ "$code" == 200 ]] && ok "публичная ссылка открывается (как у видео в приложении)" || bad "публичная ссылка: HTTP $code"
  code=$(curl -s -m 30 -o /dev/null -w '%{http_code}' -K <(svc) -X DELETE "https://$DOMAIN/storage/v1/object/ai-generated-videos/$path" || echo 000)
  [[ "$code" == 200 ]] && ok "пробный файл удалён" || bad "пробный файл не удалён (HTTP $code): ai-generated-videos/$path"
}

# ---------------------------------------------------------------------------------------------
confirm() {
  local answer
  read -r -p "    Введите «да», чтобы продолжить: " answer || answer=""
  [[ "$answer" == да ]] || die "Ничего не изменено."
}

NOW=$(backend_now)
step "Сейчас"
info "хранилище держит файлы: $([[ "$NOW" == s3 ]] && echo "в бакете S3" || echo "на диске сервера ($NOW)")"
info "файлов в хранилище: $(q -c 'select count(*) from storage.objects'), на диске занято: $(du -sh "$DISK_ROOT" | cut -f1)"
info "версия хранилища: $(docker inspect -f '{{.Config.Image}}' "$ST_CONTAINER" 2>/dev/null)"

if [[ "${1:-}" == --keys ]]; then
  [[ "$NOW" == s3 ]] || die "Хранилище на диске — ключи бакета вводятся при обычном запуске скрипта."
  load_saved
  OLD_AK=$AK; OLD_SK=$SK
  step "Новые ключи бакета $S3_BUCKET"
  cat <<EOF
    1. В личном кабинете S3: «Доступы» → «Сменить ключи» → Ok. С этой секунды и до конца
       шага 2 файлы в приложении не открываются (обычно меньше минуты).
    2. Скопируйте оттуда новые ключи и вставьте сюда (ввод скрыт).
EOF
  ask_keys new
  [[ "$AK" != "$OLD_AK" || "$SK" != "$OLD_SK" ]] || die "Это прежние ключи — сначала нажмите «Сменить ключи» в личном кабинете. Ничего не изменено."
  check_bucket
  write_keys
  if ! restart_storage; then
    AK=$OLD_AK; SK=$OLD_SK; write_keys; restart_storage || true
    die "Хранилище не поднялось с новыми ключами — вернул прежние. Пришлите скриншот."
  fi
  ok "хранилище работает с новыми ключами"
  step "Проверка через https://$DOMAIN"
  verify s3
  [[ ${FAILS:-0} -eq 0 ]] || die "Замечаний: $FAILS — пришлите скриншот"
  printf '\n\033[1;32mГотово: ключи бакета заменены, прежние больше не нужны.\033[0m\n'
  exit 0
fi

if [[ "${1:-}" == --rollback ]]; then
  [[ "$NOW" == s3 ]] || die "Хранилище и так на диске — откатывать нечего."
  load_saved
  step "Откат на диск"
  info "хранилище снова будет держать файлы на диске; то, что сохранилось только в бакете, скачается на диск"
  info "файлы в бакете не удаляются"
  confirm
  switch_to_disk || die "Хранилище не поднялось на диске — пришлите скриншот"
  restore_from_s3 || die "Не всё вернулось с бакета — пришлите скриншот (хранилище уже на диске)"
  [[ "$(backend_now)" == file ]] && ok "хранилище на диске" || bad "хранилище не на диске: $(backend_now)"
  verify disk
  [[ ${FAILS:-0} -eq 0 ]] || die "Замечаний: $FAILS — пришлите скриншот"
  printf '\n\033[1;32mГотово: хранилище снова на диске сервера.\033[0m\n'
  exit 0
fi

if [[ "$NOW" == s3 ]]; then
  load_saved
  step "Хранилище уже в бакете $S3_BUCKET — только проверка"
  verify s3
  [[ ${FAILS:-0} -eq 0 ]] || die "Замечаний: $FAILS — пришлите скриншот. Откат: sudo bash $0 --rollback"
  printf '\n\033[1;32mВсё в порядке: файлы хранятся в S3.\033[0m\n'
  exit 0
fi

ask_s3
check_bucket
step "Копирование файлов в бакет (диск не меняется)"
copy_to_s3 "первый проход" || die "Не все файлы скопировались — ничего не переключено. Пришлите скриншот."

step "Переключение"
cat <<EOF
    Хранилище сервера начнёт держать файлы в бакете $S3_BUCKET вместо диска:
      · видео, баннеры и генерации открываются как раньше, через https://$DOMAIN;
      · файлы на диске остаются как есть (путь назад: sudo bash $0 --rollback);
      · хранилище перезапустится, это несколько секунд.
EOF
confirm
copy_to_s3 "докопирование перед переключением" || die "Не все файлы скопировались — ничего не переключено."
if ! switch_to_s3; then
  warn "хранилище не поднялось с бакетом — возвращаю на диск"
  switch_to_disk || die "Хранилище не поднялось — пришлите скриншот"
  die "Ничего не изменено (хранилище снова на диске). Пришлите скриншот."
fi
[[ "$(backend_now)" == s3 ]] && ok "хранилище держит файлы в бакете $S3_BUCKET" || bad "хранилище не переключилось: $(backend_now)"
copy_to_s3 "последние секунды до переключения" || bad "не все последние файлы скопировались"

step "Проверка через https://$DOMAIN"
verify s3
if [[ ${FAILS:-0} -gt 0 ]]; then
  warn "проверка не прошла — возвращаю хранилище на диск"
  switch_to_disk && restore_from_s3 || true
  die "Хранилище снова на диске, ничего не потеряно. Пришлите скриншот всего окна (секретов в нём нет)."
fi
printf '\n\033[1;32mГотово: файлы хранятся в S3 (%s).\033[0m Файлы на диске остались как запасные; откат: sudo bash %s --rollback\n' "$S3_BUCKET" "$0"
