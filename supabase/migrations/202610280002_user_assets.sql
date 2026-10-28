-- User assets: every finished generation is kept for its owner, so it shows up again after a reload
-- and on any device (the Assets panel, the Generation history).
--   * user_assets: one row per kept file and whose it is. Written and read only by the Edge
--     Functions (service role): generate-image, generate-video, generate-video-pro write, user-assets
--     lists (with signed links) and deletes. No policies for anon or authenticated.
--   * user-generations: a private bucket for the images (read through signed links only). Videos
--     already live in the ai-generated-videos bucket and only get a row.
--   * Videos made before this change are listed too: a settled video job keeps its link in
--     generation_reservations.result, and the file is still in the video bucket. Images were never
--     stored, so there is nothing to bring back for them.
--
-- Comments avoid apostrophes and dollar signs on purpose: the Studio SQL editor splits scripts on
-- them inside comments.

create table if not exists public.user_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('image', 'video')),
  bucket text not null check (bucket in ('user-generations', 'ai-generated-videos')),
  path text not null check (length(path) between 1 and 300),
  mime text not null default '' check (length(mime) <= 100),
  bytes bigint check (bytes is null or bytes >= 0),
  model text not null default '' check (length(model) <= 120),
  prompt text not null default '' check (length(prompt) <= 4000),
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (bucket, path)
);
create index if not exists user_assets_owner_idx on public.user_assets (user_id, created_at desc);
alter table public.user_assets enable row level security;  -- no policies: service role only

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('user-generations', 'user-generations', false, 52428800, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 52428800,
  allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp'];

-- videos made before: the settled job link points at a file that is still in the video bucket
insert into public.user_assets (user_id, kind, bucket, path, mime, model, created_at)
select r.user_id, 'video', 'ai-generated-videos', o.name, 'video/mp4', left(coalesce(r.model, ''), 120),
       coalesce(r.settled_at, r.created_at)
  from public.generation_reservations r
 cross join lateral jsonb_array_elements_text(case when jsonb_typeof(r.result -> 'urls') = 'array' then r.result -> 'urls' else '[]'::jsonb end) as u(url)
  join storage.objects o
    on o.bucket_id = 'ai-generated-videos'
   and o.name = substring(u.url from '/object/public/ai-generated-videos/([^?]+)')
 where r.status = 'settled' and r.category = 'video'
on conflict (bucket, path) do nothing;
