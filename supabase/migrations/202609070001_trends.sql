-- Apply once in Supabase SQL Editor. No changes to existing user/credit tables.
create extension if not exists pg_trgm with schema extensions;
create table if not exists public.trend_prompts (
  id text primary key,
  title text not null check (length(title) between 1 and 300),
  description text not null default '',
  prompt text not null check (length(prompt) between 1 and 100000),
  kind text not null check (kind in ('image', 'video')),
  model text not null default '',
  categories text[] not null default '{}',
  collections text[] not null default '{}',
  thumbnail_url text,
  video_url text,
  source_url text,
  author text not null default '',
  published_at timestamptz,
  imported_at timestamptz not null default now(),
  popularity double precision check (popularity >= 0),
  aspect_ratio text,
  search_text text generated always as (lower(title || ' ' || description || ' ' || prompt)) stored
);
alter table public.trend_prompts enable row level security;
drop policy if exists "Public trend catalog" on public.trend_prompts;
create policy "Public trend catalog" on public.trend_prompts for select to anon, authenticated using (true);
revoke all on public.trend_prompts from anon, authenticated;
grant select on public.trend_prompts to anon, authenticated;
grant all on public.trend_prompts to service_role;
create index if not exists trends_search_idx on public.trend_prompts using gin (search_text extensions.gin_trgm_ops);
create index if not exists trends_categories_idx on public.trend_prompts using gin (categories);
create index if not exists trends_collections_idx on public.trend_prompts using gin (collections);
create index if not exists trends_kind_model_idx on public.trend_prompts (kind, model);
create index if not exists trends_date_idx on public.trend_prompts (published_at desc nulls last, id);
create index if not exists trends_popularity_idx on public.trend_prompts (popularity desc nulls last, id);

-- One public read RPC; invoker security keeps the table's RLS effective.
-- Facets describe the entire catalog, so filters remain usable after zero matches.
create or replace function public.search_trends(
  p_query text default '', p_kind text default '', p_model text default '',
  p_category text default '', p_collection text default '', p_sort text default 'newest',
  p_offset integer default 0, p_limit integer default 36, p_ids text[] default null
) returns jsonb language sql stable security invoker set search_path = public as $$
with matching as materialized (
  select * from public.trend_prompts
  where (coalesce(p_query, '') = '' or search_text like '%' || replace(replace(replace(lower(left(p_query, 300)), '\', '\\'), '%', '\%'), '_', '\_') || '%')
    and (coalesce(p_kind, '') = '' or kind = p_kind)
    and (coalesce(p_model, '') = '' or model = p_model)
    and (coalesce(p_category, '') = '' or categories @> array[p_category])
    and (coalesce(p_collection, '') = '' or collections @> array[p_collection])
    and (p_ids is null or id = any(p_ids))
), paged as (
  select * from matching
  order by case when p_sort = 'popular' then popularity end desc nulls last,
    coalesce(published_at, imported_at) desc, id
  offset greatest(coalesce(p_offset, 0), 0)
  limit least(greatest(coalesce(p_limit, 36), 1), 60)
)
select jsonb_build_object(
  'items', coalesce((select jsonb_agg(to_jsonb(p) - 'search_text') from paged p), '[]'::jsonb),
  'total', (select count(*) from matching),
  'facets', jsonb_build_object(
    'models', coalesce((select jsonb_agg(v order by v) from (select distinct model as v from public.trend_prompts where model <> '') s), '[]'::jsonb),
    'categories', coalesce((select jsonb_agg(v order by v) from (select distinct unnest(categories) as v from public.trend_prompts) s), '[]'::jsonb),
    'collections', coalesce((select jsonb_agg(v order by v) from (select distinct unnest(collections) as v from public.trend_prompts) s), '[]'::jsonb)
  )
);
$$;
revoke all on function public.search_trends(text,text,text,text,text,text,integer,integer,text[]) from public;
grant execute on function public.search_trends(text,text,text,text,text,text,integer,integer,text[]) to anon, authenticated, service_role;
