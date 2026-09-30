-- Apply once in Supabase SQL Editor.
--
-- messenger-files and ai-generated-videos are public buckets: their object URLs open without any
-- policy at all. The SELECT policies on storage.objects added in 202609090001/202609090002 were
-- therefore not needed for downloads, but they did let anyone holding the public anon key LIST
-- every object in both buckets (Storage list API) — every file shared in any chat and every
-- generated video. Dropping them keeps all existing links working and makes paths truly unlisted.
drop policy if exists "Messenger files public read" on storage.objects;
drop policy if exists "AI generated videos public read" on storage.objects;
