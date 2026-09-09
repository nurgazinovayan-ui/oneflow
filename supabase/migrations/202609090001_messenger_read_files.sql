-- Apply once in Supabase SQL Editor, after 202609070003_messenger.sql and
-- 202609070004_messenger_media.sql.
-- Adds two things to the messenger:
--  1. Read receipts: messenger_members.last_read_at, stamped by the new
--     messenger-mark-read Edge Function whenever a member opens/views a channel. A message is
--     "read" once every other member's last_read_at is >= the message's created_at — computed
--     client-side from the member list messenger-list-channels/messenger-list-messages already
--     return, not a separate per-message-per-recipient table (simpler, and matches how most chat
--     apps' single/double-tick actually works: "seen up to this point in time", not a distinct
--     receipt per message).
--  2. File sharing: kind gains a 'file' option alongside text/sticker/gif, plus file_size for
--     display ("2.4 MB"). The file itself lives in Storage (see the bucket below), uploaded by
--     messenger-upload-file; media_url points at its public object URL and body carries the
--     original filename.

alter table public.messenger_members add column if not exists last_read_at timestamptz;
-- Backfill: treat existing members as caught-up as of now rather than leaving this null (which
-- would otherwise read as "every past message is still unread" the first time this ships).
update public.messenger_members set last_read_at = now() where last_read_at is null;

alter table public.messenger_messages drop constraint if exists messenger_messages_kind_check;
alter table public.messenger_messages add constraint messenger_messages_kind_check
  check (kind in ('text', 'sticker', 'gif', 'file'));

alter table public.messenger_messages add column if not exists file_size bigint;

alter table public.messenger_messages drop constraint if exists messenger_messages_content_check;
alter table public.messenger_messages add constraint messenger_messages_content_check
  check (
    (kind in ('gif', 'file') and media_url is not null)
    or (kind not in ('gif', 'file') and length(body) >= 1)
  );

-- Storage bucket for shared files. Public read (object paths are namespaced by a random
-- channel-member-checked UUID from messenger-upload-file, so this is "unlisted", the same
-- practical security level as the GIF URLs already stored in media_url) rather than a private
-- bucket + signed URLs, to keep this in line with the rest of the messenger's effort/complexity
-- level. All writes go through messenger-upload-file (service role), same as every other
-- messenger table — no INSERT/UPDATE storage policy for authenticated is needed or granted.
insert into storage.buckets (id, name, public, file_size_limit)
values ('messenger-files', 'messenger-files', true, 26214400) -- 25 MB
on conflict (id) do update set public = true, file_size_limit = 26214400;

drop policy if exists "Messenger files public read" on storage.objects;
create policy "Messenger files public read" on storage.objects for select to public
  using (bucket_id = 'messenger-files');
