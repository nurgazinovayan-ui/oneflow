# Внедрение защиты: порядок, настройки, откат

Документ к аудиту `docs/security/audit.md`. Здесь описано, что и в каком порядке применить в production, какие значения должен утвердить владелец и как откатиться.

Сейчас ничего из этого в production не применено: код лежит в ветке `claude/motion-engine` (oneflow) и `claude/oneflow-setup-8wg1e4` (test_ayan/admin). Production-базу, DNS, сетевые и платёжные настройки я не трогал.

## Что нужно утвердить владельцу

Денежные пороги я не выбирал: данных о реальном трафике и бюджете нет. Все они хранятся в `public.app_settings`. Значение `-1` означает «выключено». Меняются они SQL-запросом или из админки (только выключатель), без нового деплоя.

| Ключ | Что ограничивает | Значение после миграции | Кто решает |
|---|---|---|---|
| `paid_generation_enabled` | Выключатель всех новых платных генераций: `1` — работают, `0` — остановлены | `1` | — |
| `global_daily_usd_cap` | Расход всех пользователей вместе за сутки (UTC), USD | `-1` (выкл.) | **владелец** |
| `global_hourly_usd_cap` | Расход всех пользователей за последний час, USD | `-1` (выкл.) | **владелец** |
| `user_daily_usd_cap` | Расход одного аккаунта за сутки (UTC), USD | `-1` (выкл.) | **владелец** |
| `alert_user_daily_usd` | Порог уведомления по одному аккаунту, USD/сутки | `-1` (выкл.) | **владелец** |
| `alert_global_daily_usd` | Порог уведомления по всему сервису, USD/сутки | `-1` (выкл.) | **владелец** |
| `user_paid_per_minute` | Платных запросов в минуту от одного аккаунта | `30` | технический лимит, проверьте |
| `ip_paid_per_minute` | Платных запросов в минуту с одного IP | `120` | технический лимит, проверьте |
| `submitted_job_max_hours` | Через сколько часов неопрошенная видео-задача списывается по оценке | `24` | технический |
| `pending_job_max_minutes` | Через сколько минут зависшая синхронная задача считается упавшей | `20` | технический |
| `generation_overrides.pool_monthly_usd` | Месячный пул расхода организации (домен), USD | `NULL` (без пула) | **владелец**, по каждой организации |

Как выбрать числа:
- посмотрите в `generation_log` реальный расход по дням за последний месяц (запрос ниже);
- глобальный дневной лимит ставьте выше обычного пика, но ниже суммы, потерю которой вы готовы пережить;
- порог уведомления ставьте ниже лимита, чтобы успеть отреагировать до блокировки.

```sql
-- расход по дням (USD), последние 30 дней
select date_trunc('day', created_at) as day, round(sum(cost_usd)::numeric, 2) as usd, count(*) as jobs
from public.generation_log where created_at > now() - interval '30 days'
group by 1 order by 1 desc;

-- самые дорогие аккаунты за 30 дней
select user_id, round(sum(cost_usd)::numeric, 2) as usd, count(*) as jobs
from public.generation_log where created_at > now() - interval '30 days'
group by 1 order by 2 desc limit 20;
```

Если столбцы в вашей `generation_log` называются иначе, сверьтесь со `supabase/schema.sql`.

Пример установки (числа здесь условные, это не рекомендация):

```sql
update public.app_settings set value = <число> where key = 'global_daily_usd_cap';
update public.app_settings set value = <число> where key = 'alert_global_daily_usd';
```

## Порядок внедрения

Порядок важен. Новые функции без миграции отвечают 503 на каждую платную генерацию: шлюз `reserve_generation_v2` не найден, поэтому срабатывает fail closed. Старые функции с новой миграцией работают: старый `reserve_generation` теперь вызывает новый шлюз, а `settle_generation` принимает прежние три аргумента.

### Шаг 1. Резервная копия

1. Supabase → Database → Backups: убедитесь, что есть свежий ежедневный бэкап. Если включён PITR, запишите текущее время: это точка восстановления.
2. Без PITR сделайте логический дамп таблиц денег перед миграцией. Строку подключения возьмите в Dashboard → Connect; в документы и чаты её не вставляйте.

```bash
pg_dump "$DATABASE_URL" --data-only \
  -t public.credit_packs -t public.generation_reservations -t public.generation_log \
  -t public.subscriptions -t public.app_settings -t public.generation_overrides \
  > backup-before-security-$(date +%Y%m%d).sql
```

Файл дампа содержит пользовательские данные: храните его вне репозитория и удалите после проверки.

### Шаг 2. Миграция

Supabase → SQL Editor → вставьте `supabase/migrations/202610090001_security_hardening.sql` целиком → Run.

Миграция только добавляет. Она не удаляет пользователей, проекты, пакеты кредитов и записи журналов и не обнуляет балансы. Что она меняет в существующем:
- добавляет столбцы и проверку статусов в `generation_reservations`;
- заменяет функции `settle_generation`, `reserve_generation`, `credit_balance`, `grant_credits`, `ensure_free_credits`;
- делает бакет `messenger-files` приватным. Ссылки на старые файлы не ломаются: `messenger-list-messages` выдаёт для них подписанные ссылки;
- отзывает у `anon` и `authenticated` право вызывать денежные функции.

Проверка после запуска:

```sql
select key, value from public.app_settings order by key;
select count(*) from public.credit_ledger;              -- 0 сразу после миграции: журнал ведётся с этого момента
select public from storage.buckets where id = 'messenger-files';   -- false
select has_function_privilege('authenticated', 'public.grant_credits(uuid,text,integer,numeric,text,text)', 'execute');  -- false
```

### Шаги 3–6. Supabase Auth (Dashboard → Authentication)

Эти настройки нельзя проверить без доступа к Dashboard (риск R-01). Их стоит включить независимо от остальных шагов.

**Шаг 3. Подтверждение email и лимиты.**
- Sign In / Providers → Email: включите **Confirm email**. Шлюз в любом случае не даёт генерировать без подтверждённого email, но без этой настройки бот может создавать аккаунты массово.
- Rate Limits: проверьте лимиты на отправку писем, вход, регистрацию и обновление токена. Значения по умолчанию разумные, но не отключены ли они, видно только там.

**Шаг 4. CAPTCHA.**
- Attack Protection → **Enable CAPTCHA protection** (hCaptcha или Cloudflare Turnstile). Нужны ключ сайта и секрет провайдера CAPTCHA.
- Внимание: после включения регистрация и вход без токена CAPTCHA перестанут работать. Клиент (`WebAuthGate.tsx`) пока не отправляет `captchaToken`. Сначала нужно добавить виджет в форму, потом включать. Это отдельная задача, в этом изменении она не сделана.

**Шаг 5. Пароли.**
- Attack Protection → **Prevent use of leaked passwords** (на тарифах, где доступно).
- Минимальная длина пароля — не меньше 8.

**Шаг 6. MFA и сессии.**
- Multi-Factor → включите **TOTP**.
- Войдите в приложение под администратором и подключите TOTP в профиле Supabase. Или используйте `supabase.auth.mfa.enroll`, если в админке появится экран подключения.
- Только после этого поставьте секрет `ADMIN_REQUIRE_MFA=1` (шаг 7). Если поставить раньше, админка ответит 403, пока сессия не пройдёт MFA.
- Sessions: задайте время жизни сессии и тайм-аут неактивности, если это есть на вашем тарифе.

### Шаг 7. Секреты Edge Functions

Dashboard → Edge Functions → Secrets. Значения не храните в git. Пример без значений лежит в `supabase/functions/.env.secrets.example`.

| Секрет | Нужен для | Обязателен |
|---|---|---|
| `ADMIN_EMAILS` | Список email администраторов через запятую. Если не задан, работает прежний email владельца из кода | рекомендуется |
| `ADMIN_REQUIRE_MFA` | `1` — админ-функции требуют сессию `aal2` (шаг 6) | после шага 6 |
| `IP_HASH_SALT` | Соль для хеша IP в лимитах. Любая длинная случайная строка. Если не задан, используется `SUPABASE_URL` (хуже: его знают все) | рекомендуется |
| `ALERT_WEBHOOK_URL` | Куда отправлять уведомления о расходе. Только `https://`, например Slack Incoming Webhook или ретранслятор в Telegram. Отправляется только тип события и имя функции, без данных пользователя | по желанию |
| `VIDEO_SYNC_WAIT_MS`, `VIDEO_RESUME_WAIT_MS`, `VIDEO_POLL_INTERVAL_MS` | Тонкая настройка ожидания видео. По умолчанию 100 с / 25 с / 5 с | нет |

Существующие секреты (`OPENROUTER_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `CRON_SECRET` и другие) не меняются.

### Шаг 8. Деплой функций

1. Убедитесь, что копии общего блока совпадают:

```bash
node scripts/sync-edge-guard.mjs --check --admin-repo ../test_ayan/admin
```

2. В Studio (Edge Functions → функция → Code) вставьте новый `index.ts` и нажмите Deploy, по одной функции. Порядок:
   1. Платные: `generate-image`, `generate-video`, `generate-video-pro`, `generate-audio`, `generate-vector`, `generate-chat`, `evaluate-creative`, `marketing-ai`, `motion-storyboard`.
   2. Админские: `admin-list-online`, `admin-list-generations`, `admin-send-message`, `get-openrouter-balance`, `trendswatch-refresh`, а также из репозитория админки `admin-api` и `admin-send-message`.
   3. Остальные изменённые: `lemonsqueezy-webhook`, `messenger-upload-file`, `messenger-list-messages`, `messenger-send-message`, `yandex-asset-download`, `yandex-project-upload`, `yandex-disk-upload`.
3. **Verify JWT**:
   - **выключен** только у `lemonsqueezy-webhook` (LemonSqueezy не отправляет JWT, защита — HMAC-подпись) и у `trendswatch-refresh` (его вызывает расписание с `x-cron-secret`);
   - у всех остальных функций — **включён**. Функции и сами проверяют токен через `auth.getUser`, так что это второй рубеж.
4. Задеплойте веб-клиент (шаг 13). Новый клиент отправляет `Idempotency-Key` и умеет опрашивать видео-задачи. Без него видео дольше 100 секунд будет отвечать 202, а старый клиент покажет ошибку. Деньги при этом не теряются: задачу доведёт `reconcile_generations`.

Проверка после деплоя (на своём аккаунте, одна дешёвая генерация):

```sql
select id, status, function_name, idempotency_key is not null as has_key, cost_usd
from public.generation_reservations order by created_at desc limit 5;
select * from public.credit_ledger order by created_at desc limit 5;
```

### Шаг 9. Проверка IP-заголовков

Лимит по IP опирается на заголовки прокси (риск R-04). После деплоя:
1. Edge Functions → `generate-image` → Logs: убедитесь, что запросы проходят без ошибок.
2. Выполните запрос:

```sql
select client_ip_hash, count(*) from public.generation_reservations
where created_at > now() - interval '1 day' group by 1 order by 2 desc limit 10;
```

Если `client_ip_hash` у всех пользователей одинаковый, прокси подставляет свой адрес. Тогда отключите лимит по IP (`ip_paid_per_minute = -1`) и сообщите, какие заголовки приходят: блок нужно будет поправить. Если поле пустое, IP не определяется и лимит по IP не действует. Лимиты по аккаунту работают в любом случае.

### Шаг 10. Пороги расхода

Установите значения из таблицы «Что нужно утвердить владельцу». До этого действуют только кредиты, лимит частоты и выключатель.

### Шаг 11. Расписание сверки

`reconcile_generations` вызывается при каждом новом резерве пользователя, но только для этого пользователя. Задачи тех, кто больше не вернулся, закрывает расписание:

Integrations → Cron → Create job → тип **SQL snippet**, каждые 15 минут (`*/15 * * * *`):

```sql
select public.reconcile_generations();
```

Если Cron недоступен, глобальные лимиты всё равно учитывают зависшие задачи. Просто дольше держится зарезервированная сумма.

### Шаг 12. Жёсткий лимит у провайдера

Все лимиты выше живут в нашей базе. Последний рубеж — у провайдера, он сработает, даже если наш код обойдут или в нём найдётся ошибка:
- **OpenRouter** → Settings → Keys → ключ из `OPENROUTER_API_KEY` → **Credit limit**: поставьте месячный лимит ключа. Это самая важная настройка денежной защиты.
- **Replicate, OpenAI, Apify**: включите spend limit или бюджетные уведомления в их кабинетах.
- Не держите на балансе OpenRouter больше, чем готовы потерять за один инцидент.

### Шаг 13. Vercel

1. Соберите и выложите `dist`. `node scripts/build-vercel.mjs` теперь кладёт `dist/vercel.json` с новыми заголовками.
2. Проверьте заголовки:

```bash
curl -sI https://oneflow.art/app | grep -iE 'strict-transport|permissions-policy|cross-origin-opener|content-security-policy|x-frame|x-content-type'
```

3. Firewall (Project → Firewall):
   - включите **Bot Protection** / **Attack Challenge Mode** на время атаки (не постоянно: он мешает легитимным клиентам API);
   - лимит частоты по IP на пути `/api` не нужен: API живёт в Supabase, а не в Vercel.
4. Дополнительные домены `*.vercel.app` (Project → Settings → Domains): если они не нужны, включите Deployment Protection для preview-сборок, чтобы старые версии не были доступны публично.
5. Своего origin-сервера нет, поэтому прятать нечего. DDoS по статике принимает CDN Vercel. DDoS по API принимает платформа Supabase. Наши лимиты защищают от расхода денег, а не от объёмной атаки.

### Шаг 14. CSP: из report-only в enforce

CSP включена в режиме `Content-Security-Policy-Report-Only`: браузер сообщает о нарушениях, но ничего не блокирует.
1. Неделю смотрите консоль браузера на `/app` и `/` (Chrome DevTools → Console, ошибки `[Report Only]`).
2. Добавьте в политику найденные легитимные источники.
3. В `vercel.json` переименуйте заголовок в `Content-Security-Policy`, соберите и выложите.
4. Если что-то сломалось, переименуйте обратно (откат за один деплой).

### Шаг 15. Бэкапы и восстановление

- Включите **PITR** (Database → Backups), если тариф позволяет. Для сервиса с деньгами это стоит своих денег.
- Раз в квартал проверяйте восстановление: восстановите бэкап в отдельный проект и выполните на нём запросы проверки из шага 2. Бэкап без проверенного восстановления — это надежда, а не бэкап.
- Таблицы `credit_ledger`, `credit_packs`, `generation_log`, `security_events` нельзя чистить: это финансовый и аудиторский след.

## Откат

| Что откатить | Как | Последствия |
|---|---|---|
| Новые функции | В Studio вставьте прежнюю версию: `git show <коммит-до-изменений>:supabase/functions/<имя>/index.ts`, затем Deploy | Возвращаются найденные уязвимости (F-01, F-02, F-07 и др.). Старые функции совместимы с новой миграцией |
| Веб-клиент | Vercel → Deployments → предыдущий → Promote to Production | Видео дольше 100 секунд будет показывать ошибку |
| Пороги | `update public.app_settings set value = -1 where key = '<ключ>';` | Порог выключен |
| Лимиты частоты | `update public.app_settings set value = -1 where key in ('user_paid_per_minute', 'ip_paid_per_minute');` | Остаются кредиты и `max_parallel_jobs` |
| Приватность `messenger-files` | `update storage.buckets set public = true where id = 'messenger-files';` | Возвращает F-04. Делать только если подписанные ссылки сломались, и вернуть обратно после исправления |
| MFA для админа | Удалите секрет `ADMIN_REQUIRE_MFA` | Админ без MFA |
| Блокировка аккаунта | `delete from public.generation_blocks where user_id = '<uuid>';` | Пользователь снова может генерировать |
| Миграция целиком | **Не откатывать удалением.** Таблицы `credit_ledger`, `credit_debts`, `security_events`, `webhook_events` хранят финансовые и аудиторские записи. Если нужно вернуть поведение, откатите функции (первая строка таблицы) | — |
| Полное восстановление базы | PITR на время до шага 2 | Теряются все изменения после этого момента, включая платежи и генерации. Только по отдельному решению |

## Постепенное включение

Минимальный риск для пользователей:
1. День 1: шаги 1–2 и 7–9, все пороги `-1`. Поведение для пользователей прежнее, плюс идемпотентность, журнал и лимит частоты.
2. День 2–3: смотрите `security_events` и `generation_reservations`. Сравните `client_ip_hash`. Убедитесь, что нет ложных `rate_limited`.
3. Затем установите пороги уведомлений (`alert_*`) на уровне реального расхода.
4. Через неделю включите жёсткие лимиты (`*_cap`) с запасом выше пиков.
5. Параллельно: CAPTCHA (после доработки формы), MFA для админа, enforce CSP.
