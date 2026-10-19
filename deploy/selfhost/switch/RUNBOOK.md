# Переключение oneflow.art на сервер в Казахстане

Сайт остаётся на Vercel; меняется только сервер, к которому он обращается
(`*.supabase.co` → `https://api.oneflow.art`). Ожидаемый простой — около 30 минут.

## Накануне

1. Учебное восстановление из резервной копии:
   `sudo oneflow-backup restore-test` — все три строки с ✓.
2. Проверка готовности: `sudo bash ~/oneflow-switch/switch.sh precheck` — «Готово к переключению».

## День переключения

| # | Где | Что |
|---|-----|-----|
| 1 | Vercel | Загрузить `oneflow-maintenance.zip` в production — на сайте «Технические работы». Старая база больше не меняется. |
| 2 | Сервер (tmux) | `sudo bash ~/oneflow-migrate/migrate.sh --reset` → слово ОЧИСТИТЬ (удаляет только репетиционную копию на этом сервере). |
| 3 | Сервер | `sudo bash ~/oneflow-migrate/migrate.sh` → строка Session pooler, пароль базы, service_role. В сверке — только ✓ и ~. |
| 4 | Сервер | `sudo bash ~/oneflow-switch/switch.sh finish` → ссылки на файлы, расписание трендов, резервная копия, проверки. В конце «Сервер готов». |
| 5 | Vercel | Загрузить `oneflow-art-site-v18.zip` в production. Если в Settings → Environment Variables есть `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` — заменить на новые (как в `.env.web.example`). |
| 6 | LemonSqueezy | Только если он используется: Settings → Webhooks → Callback URL `https://api.oneflow.art/functions/v1/lemonsqueezy-webhook`. Если нет — приостановить магазин/товар в LemonSqueezy, чтобы никто не оплатил мимо нового сервера. |
| 7 | Браузер | Проверка: вход по почте и через Google на oneflow.art/app, список генераций, одна недорогая генерация, /admin, мессенджер, «Забыли пароль?» (письмо приходит). |

## Откат (в первые часы)

`sudo bash ~/oneflow-switch/switch.sh rollback` — печатает шаги: прежняя версия сайта (v17) в Vercel,
прежний адрес вебхука LemonSqueezy. Данные, созданные после переключения, остаются только на новом
сервере — поэтому решение об откате принимается сразу после проверки.

## После

- Старый проект Supabase не удалять 2 недели (путь отката, старые ссылки у программы для компьютера).
- Удаление старого проекта — отдельное решение владельца.
