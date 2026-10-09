# Действия при атаке или аномальном расходе

Короткая инструкция на случай, когда что-то идёт не так: деньги у провайдера уходят быстрее обычного, пришло уведомление `ALERT_WEBHOOK_URL`, сервис тормозит или в журнале странные записи.

Главный принцип: **сначала остановить расход, потом разбираться.** Выключатель не трогает данные и снимается одной командой.

Не удаляйте пользователей, проекты, пакеты кредитов и записи журналов: это след инцидента и финансовая отчётность. Блокировка делается флагами и лимитами, а не удалением.

## 1. Первые 5 минут: остановить расход

Выберите то, что доступно быстрее.

**A. Выключатель в базе** (Supabase → SQL Editor):

```sql
update public.app_settings set value = 0 where key = 'paid_generation_enabled';
```

Все новые платные запросы сразу получают 503 `service_paused`. Уже принятые видео-задачи доводятся до конца и списываются: провайдер их уже выставил к оплате.

**B. Через админ-API** (с сессией администратора):

```bash
curl -sS -X POST "$SUPABASE_URL/functions/v1/admin-api" \
  -H "Authorization: Bearer $ADMIN_ACCESS_TOKEN" -H "Content-Type: application/json" \
  -d '{"action":"generation-pause","paused":true}'
```

Токен администратора не вставляйте в чаты и тикеты. Действие пишется в `security_events` как `admin_generation-pause`.

**C. У провайдера** — если подозреваете, что утёк сам ключ, а не идёт злоупотребление через приложение. Наш выключатель тогда не поможет: ключ используют в обход нас.
- OpenRouter → Settings → Keys → ключ → **Credit limit = 0** или Disable. Сервис встанет, пока не выпущен новый ключ (раздел 4).
- Replicate, OpenAI, Apify — аналогично в их кабинетах.

Как понять, какой случай ваш:
- запросы в `generation_reservations` растут вместе с расходом у провайдера — злоупотребление через приложение, хватит пункта A;
- у провайдера расход есть, а в `generation_reservations` тихо — ключ используется напрямую, нужен пункт C.

## 2. Диагностика

Все запросы только читают данные.

```sql
-- события безопасности за сутки
select created_at, kind, severity, user_id, details
from public.security_events where created_at > now() - interval '1 day'
order by created_at desc limit 200;

-- кто тратит прямо сейчас: резервы за последний час по пользователям
select user_id, count(*) as jobs, round(sum(amount_usd)::numeric, 2) as reserved_usd,
       count(distinct client_ip_hash) as ips, array_agg(distinct function_name) as functions
from public.generation_reservations where created_at > now() - interval '1 hour'
group by 1 order by 3 desc limit 20;

-- с каких адресов (хеш IP) идёт нагрузка
select client_ip_hash, count(*) as jobs, count(distinct user_id) as accounts
from public.generation_reservations where created_at > now() - interval '1 hour'
group by 1 order by 2 desc limit 20;

-- зависшие и незавершённые задачи
select status, count(*), round(sum(amount_usd)::numeric, 2) as usd
from public.generation_reservations where status in ('pending', 'submitted', 'finishing') group by 1;

-- массовая регистрация: новые аккаунты по часам
select date_trunc('hour', created_at) as hour, count(*),
       count(*) filter (where email_confirmed_at is null) as unconfirmed
from auth.users where created_at > now() - interval '2 days' group by 1 order by 1 desc;

-- журнал кредитов конкретного пользователя
select created_at, kind, delta, reservation_id, note
from public.credit_ledger where user_id = '<uuid>' order by created_at desc limit 50;

-- вебхуки подписок: повторы и отклонённые события
select received_at, event_name, outcome from public.webhook_events order by received_at desc limit 50;
```

Что означают типы событий в `security_events`:

| `kind` | Что произошло |
|---|---|
| `spend_alert_user`, `spend_alert_global` | Пройден порог уведомления (`alert_*`). Генерации продолжаются |
| `spend_cap_user_daily`, `spend_cap_global_daily`, `spend_cap_global_hourly`, `spend_cap_pool` | Сработал жёсткий лимит, запросы отклоняются с `spend_limit` |
| `credit_debt` | Реальная стоимость превысила остаток кредитов, разница записана в долг |
| `job_expired` | Синхронная задача зависла (функция упала), резерв освобождён |
| `job_auto_settled` | Видео-задачу никто не опросил за `submitted_job_max_hours`, она списана по оценке |
| `admin_*` | Действие администратора (`admin_send_message`, `admin_generation-pause`, `admin_credits-grant` и т. д.) |

Отказы по частоте (`rate_limited`) не пишутся в журнал, чтобы атака не раздувала таблицу. Их видно в Edge Functions → Logs по ответам 429.

## 3. Локализовать

**Один аккаунт злоупотребляет.**
1. Немедленно запретите ему платные генерации. Блокировка действует со следующего запроса, независимо от кредитов, подписки и override. Пользователь получит 403 `account_blocked`.

```sql
insert into public.generation_blocks (user_id, reason)
select id, 'инцидент <дата>: <кратко>' from auth.users where lower(email) = lower('<email пользователя>')
on conflict (user_id) do update set reason = excluded.reason;
```

   Не используйте для этого `generation_overrides` с лимитом 0: у пользователя с активной подпиской лимит подписки больше, и override его не остановит.
2. При необходимости заблокируйте вход: Authentication → Users → пользователь → **Ban user**. Не удаляйте пользователя.
3. Снять блокировку: `delete from public.generation_blocks where user_id = '<uuid>';`. Удаляется только строка блокировки. Аккаунт, проекты и кредиты не затрагиваются.

**Много аккаунтов, один источник.**
- Включите или ужесточите `ip_paid_per_minute`.
- Включите CAPTCHA в Supabase Auth (см. `deployment.md`, шаг 4: сначала нужна доработка формы).
- Если поток регистраций не подтверждает email, генерация им и так недоступна.

**Весь сервис под нагрузкой (DDoS).**
- Статика: Vercel → Firewall → **Attack Challenge Mode**.
- API: Supabase держит нагрузку на уровне платформы. Наша задача — чтобы атака не стоила денег: проверьте выключатель и глобальные лимиты. При длительной атаке обратитесь в поддержку Supabase.
- Сразу после окончания атаки выключите Attack Challenge Mode: он мешает легитимным API-клиентам.

## 4. Ротация ключей

Ротируйте ключ, если он мог утечь: попал в git, логи, скриншот, чат или к бывшему сотруднику. Порядок для каждого: **выпустить новый → обновить секрет → проверить работу → отозвать старый.** Не отзывайте старый ключ, пока новый не проверен, иначе сервис встанет.

| Секрет | Где выпустить новый | Где обновить | Особенности |
|---|---|---|---|
| `OPENROUTER_API_KEY` | openrouter.ai → Settings → Keys | Edge Functions → Secrets | Сразу поставьте Credit limit на новый ключ |
| `SUPABASE_SERVICE_ROLE_KEY` | Project Settings → API Keys (новые secret-ключи) или ротация JWT secret | Подставляется платформой автоматически | Ротация JWT secret завершает все сессии пользователей |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | LemonSqueezy → Settings → Webhooks | Edge Functions → Secrets | Обновить одновременно в обоих местах, иначе вебхуки будут отклоняться (LemonSqueezy повторит доставку) |
| `CRON_SECRET` | Любой генератор паролей, 32+ символа | Secrets + заголовок `x-cron-secret` в задаче Cron | — |
| `REPLICATE_API_KEY`, `OPENAI_API_KEY`, `APIFY_API_TOKEN`, `GIPHY_API_KEY` | Кабинет провайдера | Edge Functions → Secrets | — |
| `YANDEX_CLIENT_SECRET` | oauth.yandex.ru | Edge Functions → Secrets | — |
| `YANDEX_TOKEN_ENCRYPTION_KEY` | — | — | **Не менять без миграции**: им зашифрованы сохранённые токены пользователей. Смена = все пользователи заново подключают Яндекс.Диск |
| `IP_HASH_SALT` | Любая случайная строка | Edge Functions → Secrets | Смена только сбрасывает счётчики лимита по IP |

Поиск утёкшего секрета в истории git — только инструментами, которые маскируют значения:

```bash
gitleaks detect --redact -v      # или: trufflehog git file://. --no-verification --json | jq '.SourceMetadata'
```

Если секрет найден в истории, ротация обязательна. Переписывание истории его не «отзывает»: копии уже могли разойтись.

## 5. Восстановить работу

1. Убедитесь, что причина устранена: аккаунт ограничен, ключ заменён, лимиты выставлены.
2. Включите генерацию обратно:

```sql
update public.app_settings set value = 1 where key = 'paid_generation_enabled';
```

3. Первый час смотрите `security_events` и расход у провайдера.

## 6. После инцидента

- **Сверка денег.** Сравните сумму `generation_log.cost_usd` за период инцидента со счётом провайдера. Расхождение покажет вызовы в обход приложения (утечка ключа) или задачи, потерянные на таймауте (риск R-03).
- **Компенсация пользователям**, если они пострадали: начислить кредиты через админку (`credits-grant`) или `grant_credits` с уникальным `p_external_id`. Повторный вызов с тем же id ничего не начислит. **Не начисляйте кредиты по скриншоту оплаты или сообщению пользователя**: только по записи платёжной системы.
- **Сохраните след.** Не чистите `security_events`, `generation_reservations`, `credit_ledger`. Экспортируйте логи Edge Functions за период: Supabase хранит их ограниченное время.
- **Запишите** хронологию, причину, ущерб и что изменить, чтобы не повторилось. Пересмотрите пороги в `app_settings`.
