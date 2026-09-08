-- Apply once in Supabase SQL Editor, after 202609070003_messenger.sql.
-- Adds sticker/GIF support to messenger_messages: kind distinguishes plain text from a
-- sticker (an emoji rendered large, stored in body -- no new asset, no external service) and a
-- GIF (stored as a URL in media_url, sourced through messenger-gif-search / Giphy). Validation
-- of media_url (HTTPS-only) happens in messenger-send-message, same as every other URL in this
-- app -- not duplicated here as a regex CHECK.
alter table public.messenger_messages add column if not exists kind text not null default 'text';
alter table public.messenger_messages drop constraint if exists messenger_messages_kind_check;
alter table public.messenger_messages add constraint messenger_messages_kind_check
  check (kind in ('text', 'sticker', 'gif'));

alter table public.messenger_messages add column if not exists media_url text;

-- Original 202609070003 created "check (length(body) between 1 and 4000)" unnamed on the body
-- column, which Postgres auto-names messenger_messages_body_check -- replaced here since a GIF
-- message can have an empty body (caption is optional).
alter table public.messenger_messages drop constraint if exists messenger_messages_body_check;
alter table public.messenger_messages add constraint messenger_messages_body_check
  check (length(body) <= 4000);

alter table public.messenger_messages drop constraint if exists messenger_messages_content_check;
alter table public.messenger_messages add constraint messenger_messages_content_check
  check ((kind = 'gif' and media_url is not null) or (kind <> 'gif' and length(body) >= 1));
