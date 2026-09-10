// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "trendswatch-refresh" → paste this file → Deploy. Turn "Verify JWT" OFF — this only ever runs
// on a schedule (Edge Functions → trendswatch-refresh → Cron, e.g. once a day) or via a manual
// "Invoke" from Supabase Studio, never called from the client directly, so there's no user JWT
// to verify.
//
// Secrets needed (Edge Functions → trendswatch-refresh → Secrets):
//   APIFY_API_TOKEN — apify.com → Settings → Integrations → API tokens.
//   OPENROUTER_API_KEY — the same key already used by generate-*/evaluate-creative
//                         (openrouter.ai/settings/keys).
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are already set automatically for every Edge Function
// in this project.
//
// Pulls today's trending TikTok + Instagram Reels via Apify actors (real, currently-trending
// video URLs/thumbnails/engagement stats — not a guess this app makes up), asks an OpenRouter
// model with web search (the ":online" model suffix, OpenRouter's built-in search grounding)
// to compile today's Threads trends as text (Threads has no scraper wired here — its own API
// barely exposes read access to anything, so there's no real video preview for it, only a
// source link), then asks the same model for a short "what to do with this" tip per item, and
// stores everything in trend_watch_items for the Trendswatching panel to read (open "select"
// RLS — see the SQL below).
//
// The Apify actor ids/input fields below are this integration's best-known shape at the time
// this was written, NOT independently confirmed against a live call — Apify actors change their
// input schema and rename/replace often. If a run comes back with an error or an empty dataset,
// open that actor's own page in the Apify Console (apify.com/<owner>/<actor-name> → Input tab)
// to see its current input fields and adjust runApifyActor's callers below; the error text or an
// empty items array is what tells you what to fix, same as the rest of this project's OpenRouter
// integrations that also weren't confirmed live before shipping (see e.g. generate-audio's Lyria
// comment).
//
// Requires the trend_watch_items table — run this once in Supabase Studio's SQL editor:
//
//   create table if not exists public.trend_watch_items (
//     id uuid primary key default gen_random_uuid(),
//     platform text not null check (platform in ('tiktok', 'instagram', 'threads')),
//     title text not null,
//     description text,
//     video_url text,
//     thumbnail_url text,
//     source_url text,
//     author text,
//     stats jsonb not null default '{}'::jsonb,
//     ai_advice text,
//     popularity_score numeric not null default 0,
//     fetch_date date not null default current_date,
//     fetched_at timestamptz not null default now()
//   );
//   alter table public.trend_watch_items enable row level security;
//   drop policy if exists "anyone can read trend watch items" on public.trend_watch_items;
//   create policy "anyone can read trend watch items" on public.trend_watch_items
//     for select using (true);
//   -- No write policy — this isn't per-user data (same content for every signed-in visitor),
//   -- so an open select is fine; only this function (service role) ever writes here.
//   create index if not exists trend_watch_items_fetch_date_idx on public.trend_watch_items (fetch_date desc);
//   create index if not exists trend_watch_items_platform_idx on public.trend_watch_items (platform);
//   create index if not exists trend_watch_items_popularity_idx on public.trend_watch_items (fetch_date desc, popularity_score desc);
//
// Upgrading an already-deployed table (adds the column the two lines above depend on):
//   alter table public.trend_watch_items add column if not exists popularity_score numeric not null default 0;

import { createClient } from 'npm:@supabase/supabase-js@2';

const APIFY_API_TOKEN = Deno.env.get('APIFY_API_TOKEN') ?? '';
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions';
// ":online" turns on OpenRouter's built-in web-search grounding for this model — needed for
// fetchThreadsTrends' web research; addAdvice below deliberately uses the plain (non-":online")
// slug since it only reasons over the items already collected, not the live web.
const TRENDS_SEARCH_MODEL = 'openai/gpt-5.6-terra:online';
const ADVICE_MODEL = 'openai/gpt-5.6-terra';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

type Platform = 'tiktok' | 'instagram' | 'threads';

interface TrendItem {
  platform: Platform;
  title: string;
  description?: string | null;
  video_url?: string | null;
  thumbnail_url?: string | null;
  source_url?: string | null;
  author?: string | null;
  stats?: Record<string, number>;
  ai_advice?: string;
}

const MAX_ITEMS_PER_PLATFORM = 18;
// The panel's own period filter shows "up to 50/day, most popular first" as its retention
// promise — enforced here (not just by keeping MAX_ITEMS_PER_PLATFORM * 3 low) so it holds even
// if this function ends up invoked more than once for the same day.
const MAX_ITEMS_PER_DAY = 50;

// likes + reposts (weighted higher — the stronger virality signal) + comments; the same formula
// used to rank cards in the panel (order=popularity_score.desc) and to decide which items survive
// the MAX_ITEMS_PER_DAY trim below.
function popularityScore(stats: Record<string, number> | undefined): number {
  if (!stats) return 0;
  return (stats.likes ?? 0) + (stats.shares ?? 0) * 3 + (stats.comments ?? 0) * 2;
}

async function runApifyActor(actorId: string, input: Record<string, unknown>): Promise<unknown[]> {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${APIFY_API_TOKEN}&timeout=90`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  if (!res.ok) throw new Error(`Apify actor ${actorId} error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function fetchTikTokTrends(): Promise<TrendItem[]> {
  const items = await runApifyActor('clockworks~tiktok-trends-scraper', {
    resultsPerPage: MAX_ITEMS_PER_PLATFORM,
  });
  return items.slice(0, MAX_ITEMS_PER_PLATFORM).map((raw): TrendItem => {
    const item = raw as Record<string, unknown>;
    const author = item.authorMeta as Record<string, unknown> | undefined;
    const video = item.videoMeta as Record<string, unknown> | undefined;
    return {
      platform: 'tiktok',
      title: String(item.text ?? item.desc ?? 'TikTok trend').slice(0, 200),
      video_url: (video?.downloadAddr as string) ?? (item.videoUrl as string) ?? null,
      thumbnail_url:
        (video?.coverUrl as string) ?? ((item.covers as Record<string, string> | undefined)?.default ?? null),
      source_url: (item.webVideoUrl as string) ?? null,
      author: (author?.name as string) ?? (author?.nickName as string) ?? null,
      stats: {
        views: Number(item.playCount ?? 0),
        likes: Number(item.diggCount ?? 0),
        shares: Number(item.shareCount ?? 0),
        comments: Number(item.commentCount ?? 0),
      },
    };
  });
}

async function fetchInstagramTrends(): Promise<TrendItem[]> {
  const items = await runApifyActor('apidojo~instagram-scraper-api', {
    resultsType: 'posts',
    resultsLimit: MAX_ITEMS_PER_PLATFORM,
    search: 'trending reels',
    searchType: 'hashtag',
  });
  return items.slice(0, MAX_ITEMS_PER_PLATFORM).map((raw): TrendItem => {
    const item = raw as Record<string, unknown>;
    return {
      platform: 'instagram',
      title: String(item.caption ?? item.title ?? 'Instagram Reel').slice(0, 200),
      video_url: (item.videoUrl as string) ?? null,
      thumbnail_url: (item.displayUrl as string) ?? (item.thumbnailUrl as string) ?? null,
      source_url: (item.url as string) ?? null,
      author: (item.ownerUsername as string) ?? null,
      stats: {
        views: Number(item.videoPlayCount ?? item.videoViewCount ?? 0),
        likes: Number(item.likesCount ?? 0),
        comments: Number(item.commentsCount ?? 0),
      },
    };
  });
}

function extractJsonArray(text: string): Record<string, unknown>[] {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1) return [];
  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>[];
  } catch {
    return [];
  }
}

// Threads has no usable public read API/scraper here — asked for as free-text web-search
// findings instead. No real preview media for these — text + source link only.
//
// The model's web search tends to default to generic "trending in the news today" topics
// (sports scores, product launches, politics) that read like Twitter/X trends rather than
// anything specific to Threads, and sometimes even cites twitter.com/x.com as the source — the
// prompt below is explicit about rejecting that, and threadsSourceUrl() below is a hard filter
// on top of it (never trust the model's own judgment as the only gate).
function threadsSourceUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null;
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return host === 'threads.net' || host === 'threads.com' ? url : null;
  } catch {
    return null;
  }
}

async function fetchThreadsTrends(): Promise<TrendItem[]> {
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: TRENDS_SEARCH_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Ты — аналитик соцсети Threads (Meta, threads.net). Через веб-поиск найди до 5 постов или ' +
            'обсуждений, которые РЕАЛЬНО ОПУБЛИКОВАНЫ и обсуждаются именно в Threads за последние ' +
            'несколько дней. ЗАПРЕЩЕНО: посты и ссылки из Twitter/X, общие новостные темы дня, любые ' +
            'источники не с threads.net — если находишь такое, не включай в ответ вообще, лучше верни ' +
            'меньше 5 пунктов или пустой массив, чем подмени их Twitter-трендами или новостями. ' +
            'Ответь СТРОГО валидным JSON-массивом без markdown-разметки и без пояснений, схема каждого ' +
            'элемента: {"title": "...", "description": "...", "source_url": "https://threads.net/...", ' +
            '"author": "..."}. source_url обязателен, должен вести именно на threads.net и быть реальной ' +
            'ссылкой из результатов поиска, а не выдуманной.',
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenRouter Threads trends error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '[]';
  return extractJsonArray(text)
    .map((item) => ({ ...item, source_url: threadsSourceUrl(item.source_url) }))
    .filter((item) => item.source_url !== null)
    .slice(0, MAX_ITEMS_PER_PLATFORM)
    .map((item): TrendItem => ({
      platform: 'threads',
      title: String(item.title ?? 'Threads trend').slice(0, 200),
      description: item.description ? String(item.description) : null,
      source_url: item.source_url,
      author: item.author ? String(item.author) : null,
      video_url: null,
      thumbnail_url: null,
      stats: {},
    }));
}

// One combined call for advice on every item collected above, rather than one call per item —
// keeps this to at most two OpenRouter calls per run (this one + fetchThreadsTrends).
async function addAdvice(items: TrendItem[]): Promise<TrendItem[]> {
  if (items.length === 0) return items;
  const list = items
    .map((item, i) => `${i}. [${item.platform}] ${item.title}${item.description ? ' — ' + item.description : ''}`)
    .join('\n');
  const res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ADVICE_MODEL,
      messages: [
        {
          role: 'system',
          content:
            'Ты — маркетолог. Для каждого тренда из списка дай 1-2 коротких предложения на русском: ' +
            'как использовать этот тренд для рекламы или контента бренда. Ответь СТРОГО валидным JSON-объектом ' +
            'без markdown-разметки вида {"0": "совет", "1": "совет", ...}, где ключ — номер пункта из списка.',
        },
        { role: 'user', content: list },
      ],
    }),
  });
  if (!res.ok) return items; // Advice is a nice-to-have — never fail the whole refresh over it.
  const data = await res.json();
  const text: string = data.choices?.[0]?.message?.content ?? '{}';
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) return items;
  try {
    const advice = JSON.parse(text.slice(start, end + 1)) as Record<string, string>;
    return items.map((item, i) => ({ ...item, ai_advice: advice[String(i)] }));
  } catch {
    return items;
  }
}

Deno.serve(async (_req) => {
  try {
    const [tiktok, instagram, threads] = await Promise.allSettled([
      fetchTikTokTrends(),
      fetchInstagramTrends(),
      fetchThreadsTrends(),
    ]);
    const items = [
      ...(tiktok.status === 'fulfilled' ? tiktok.value : []),
      ...(instagram.status === 'fulfilled' ? instagram.value : []),
      ...(threads.status === 'fulfilled' ? threads.value : []),
    ];
    const withAdvice = await addAdvice(items);

    if (withAdvice.length > 0) {
      const { error } = await supabaseAdmin.from('trend_watch_items').insert(
        withAdvice.map((item) => ({
          platform: item.platform,
          title: item.title,
          description: item.description ?? null,
          video_url: item.video_url ?? null,
          thumbnail_url: item.thumbnail_url ?? null,
          source_url: item.source_url ?? null,
          author: item.author ?? null,
          stats: item.stats ?? {},
          ai_advice: item.ai_advice ?? null,
          popularity_score: popularityScore(item.stats),
        }))
      );
      if (error) throw error;
    }

    // Enforce the "50 trends/day, most popular kept" retention promise — a no-op on a normal
    // single-run day (MAX_ITEMS_PER_PLATFORM * 3 platforms is already under 50), but a real
    // safety net if this function is ever invoked more than once for the same fetch_date.
    const today = new Date().toISOString().slice(0, 10);
    const { data: todaysItems, error: trimSelectError } = await supabaseAdmin
      .from('trend_watch_items')
      .select('id')
      .eq('fetch_date', today)
      .order('popularity_score', { ascending: false });
    if (trimSelectError) {
      console.error('trendswatch-refresh: could not check today\'s item count', trimSelectError);
    } else if (todaysItems.length > MAX_ITEMS_PER_DAY) {
      const excessIds = todaysItems.slice(MAX_ITEMS_PER_DAY).map((row) => row.id as string);
      const { error: trimDeleteError } = await supabaseAdmin.from('trend_watch_items').delete().in('id', excessIds);
      if (trimDeleteError) console.error('trendswatch-refresh: failed to trim to MAX_ITEMS_PER_DAY', trimDeleteError);
    }

    const errors = [tiktok, instagram, threads]
      .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
      .map((r) => String(r.reason));
    if (errors.length > 0) console.error('trendswatch-refresh partial failures', errors);

    return new Response(JSON.stringify({ inserted: withAdvice.length, errors }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('trendswatch-refresh failed', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});
