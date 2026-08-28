# Настройка проекта на новом компьютере

Полная инструкция для работы с ONEFLOW через Claude Code CLI на любом Windows-компьютере —
с возможностью не только редактировать код, но и собирать `.exe`/веб-версию и тестировать
их прямо на месте.

## 1. Установить Node.js

Скачай и установи LTS-версию: **https://nodejs.org**

Проверить, что встало:

```bash
node --version
npm --version
```

## 2. Установить Git

Скачай и установи: **https://git-scm.com/download/win**

При установке можно оставить все настройки по умолчанию.

## 3. Установить Claude Code

```bash
npm install -g @anthropic-ai/claude-code
```

Дальше запусти `claude` в любой папке и войди в свой аккаунт Claude (тот же, что и на
основном компьютере) — он спросит один раз при первом запуске.

## 4. Склонировать репозиторий

```bash
git clone https://github.com/nurgazinovayan-ui/oneflow.git
cd oneflow
npm install
```

`npm install` займёт пару минут — ставит все зависимости проекта.

## 5. Настроить переменные окружения для веб-версии

```bash
cp .env.web.example .env.web
```

Ничего менять в файле не нужно — там уже актуальные публичные ключи (Supabase anon key,
Yandex OAuth client id, ссылка на LemonSqueezy). Секретные ключи (Yandex client_secret,
LemonSqueezy webhook secret и т.д.) в репозитории не хранятся — они лежат только на стороне
Supabase Edge Functions и на этот файл не влияют.

## 6. Запустить Claude Code в папке проекта

```bash
claude
```

Готово — дальше работаешь как обычно, Claude видит весь код и может его редактировать.

## Полезные команды для сборки/проверки (то же, что использует Claude)

```bash
npm run dev          # запуск desktop-приложения в режиме разработки (hot reload)
npx tsc -p tsconfig.json --noEmit   # проверка типов перед сборкой
npm run dist          # сборка desktop .exe (появится в dist/ONEFLOW-portable.exe)
npm run build:web     # сборка веб-версии (папка dist/, потом можно собрать в .zip)
```

**Важно про порядок:** `npm run dist` и `npm run build:web` оба пишут в папку `dist/` и
перезатирают друг друга. Если нужны оба артефакта — сначала `npm run dist`, скопировать
`dist/ONEFLOW-portable.exe` в другое место, потом `npm run build:web`.

## Синхронизация между компьютерами

Перед началом работы на любой машине:

```bash
git pull
```

После изменений (если работаешь не через claude.ai/code, где коммит и пуш можно доверить
самой сессии):

```bash
git add -A
git commit -m "описание изменений"
git push
```

## Если решил редактировать не локально, а через браузер

Вместо шагов 1–4 можно открыть **https://claude.ai/code**, подключить GitHub-аккаунт
`nurgazinovayan-ui` и выбрать репозиторий `oneflow` — это даёт редактирование кода из
браузера без установки чего-либо, но без возможности собрать `.exe`/протестировать в
Electron-окне (для этого нужен вариант выше, с Node.js на реальной машине).
