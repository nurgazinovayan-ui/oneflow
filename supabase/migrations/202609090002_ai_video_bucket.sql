-- Apply once in Supabase SQL Editor.
--
-- OpenRouter's Video Generation API (see generate-video/generate-video-pro) never returns a
-- plain public video URL — only an authenticated /content endpoint that requires the shared
-- OPENROUTER_API_KEY on every request, which the browser must never see. The Edge Function
-- downloads the finished MP4 server-side and re-hosts it here so the client gets back an
-- ordinary public URL, same shape as the URL Replicate used to return directly.
--
-- Public read (object paths are namespaced by a random per-generation UUID, so this is
-- "unlisted", the same practical security level as the messenger-files bucket) rather than a
-- private bucket + signed URLs, to keep this in line with that bucket's precedent
-- (202609090001_messenger_read_files.sql). All writes go through the generate-video/
-- generate-video-pro Edge Functions (service role) — no INSERT/UPDATE storage policy for
-- authenticated is needed or granted.
insert into storage.buckets (id, name, public, file_size_limit)
values ('ai-generated-videos', 'ai-generated-videos', true, 314572800) -- 300 MB
on conflict (id) do update set public = true, file_size_limit = 314572800;

drop policy if exists "AI generated videos public read" on storage.objects;
create policy "AI generated videos public read" on storage.objects for select to public
  using (bucket_id = 'ai-generated-videos');
