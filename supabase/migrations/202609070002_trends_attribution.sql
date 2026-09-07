-- Additive migration: attribution fields for imported trend_prompts records.
-- Apply once in Supabase SQL Editor, after 202609070001_trends.sql.
-- search_trends()'s to_jsonb(p) - 'search_text' already returns new columns; no RPC change needed.
alter table public.trend_prompts
  add column if not exists license text,
  add column if not exists license_url text,
  add column if not exists source_repo text,
  add column if not exists source_commit text check (source_commit is null or source_commit ~ '^[0-9a-f]{40}$');
