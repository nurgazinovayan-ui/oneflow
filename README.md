# Node AI Studio

> Настраиваешь проект на новом компьютере? См. [SETUP.md](SETUP.md) — пошаговая
> инструкция (Node.js, Git, Claude Code, клонирование, .env).

Windows-приложение (Electron + React + TypeScript) для генерации фото и видео через
нейросети, соединённые в виде нод — по образцу ComfyUI. Генерация выполняется через
[Replicate API](https://replicate.com/account/api-tokens), что даёт доступ сразу к
десяткам моделей (Flux, SDXL, Kling, LTX-Video, Stable Video Diffusion и др.) без
локальной установки моделей.

## Типы нод

- **Текстовый промпт** — узел с текстовым полем, выход подключается к генераторам.
- **Генерация фото** — выбор модели, ширина/высота, кнопка генерации, превью и сохранение файла.
- **Генерация видео** — выбор модели, промпт и/или входное изображение (можно подключить
  выход узла «Генерация фото»), превью и сохранение файла.

## Запуск в режиме разработки

```bash
npm install
npm run dev
```

Откроется окно Electron с dev-сервером Vite и авто-обновлением (HMR).

## Первый запуск: API-ключ

1. Зарегистрируйтесь на [replicate.com](https://replicate.com) и создайте токен на
   странице `Account → API tokens`.
2. В приложении нажмите «Настройки / API-ключ» и вставьте токен.
3. Токен хранится локально на компьютере (через `electron-store`) и используется только
   для запросов к Replicate.

## Сборка Windows-инсталлятора

```bash
npm run dist
```

Соберёт `.exe` (NSIS-инсталлятор) через `electron-builder` в папку `release/`.

## Структура проекта

```
electron/        # главный процесс Electron + preload (IPC-мост к Replicate API)
src/
  nodes/          # компоненты нод React Flow
  components/      # модалка настроек и т.д.
  App.tsx          # холст React Flow, сайдбар добавления нод
```

## Добавление новых моделей/провайдеров

Список моделей задан в [src/types.ts](src/types.ts) (`IMAGE_MODELS`, `VIDEO_MODELS`) —
это `owner/model` строки Replicate. Чтобы добавить нового провайдера (например,
OpenAI или Stability AI напрямую), нужно добавить обработчик в
[electron/main.ts](electron/main.ts) рядом с `generate:image` / `generate:video` и
новый пункт в списке моделей.
