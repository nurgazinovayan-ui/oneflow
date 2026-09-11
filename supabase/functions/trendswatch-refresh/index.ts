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
//     region text not null default 'unknown',
//     region_rank smallint not null default 4,
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
//   create index if not exists trend_watch_items_rank_idx on public.trend_watch_items (fetch_date desc, region_rank, popularity_score desc);
//
// Upgrading an already-deployed table (adds the columns the index above depends on):
//   alter table public.trend_watch_items add column if not exists popularity_score numeric not null default 0;
//   alter table public.trend_watch_items add column if not exists region text not null default 'unknown';
//   alter table public.trend_watch_items add column if not exists region_rank smallint not null default 4;

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
type Region = 'cis' | 'europe' | 'america' | 'unknown';

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
  region: Region;
}

// Region priority for the feed: CIS first, then Europe, then America. Stored as region_rank so
// the panel can order by it before popularity (order=region_rank.asc,popularity_score.desc)
// rather than mixing region into the score itself, which would make the score unreadable.
const REGION_RANK: Record<Region, number> = { cis: 1, europe: 2, america: 3, unknown: 4 };

// What actually counts as a "trend" — engagement, NOT which hashtag it happened to appear under.
// Anything under MIN_LIKES is an ordinary post, not a trend, and never gets stored.
const MIN_LIKES = 80_000;
// Second gate: a post can clear 80k likes purely off a huge follower count while barely engaging
// anyone. Only applied when the source actually reports view counts (Threads never does, and some
// Instagram posts don't) — no views means this check is skipped rather than failing the item.
const MIN_ENGAGEMENT_RATE = 0.05;

// The panel's own period filter shows "up to 50/day, most popular first" as its retention
// promise — enforced below so it holds even if this function is invoked more than once a day.
const MAX_ITEMS_PER_DAY = 50;

// likes + reposts (weighted higher — the stronger virality signal) + comments; the same formula
// used to rank cards within a region in the panel and to decide which items survive the
// MAX_ITEMS_PER_DAY trim below.
function popularityScore(stats: Record<string, number> | undefined): number {
  if (!stats) return 0;
  return (stats.likes ?? 0) + (stats.shares ?? 0) * 3 + (stats.comments ?? 0) * 2;
}

// The real trend gate. Deliberately applied to scraped platforms only (TikTok/Instagram) — see
// fetchThreadsTrends, which has no engagement numbers to gate on at all.
function isTrend(stats: Record<string, number> | undefined): boolean {
  const likes = stats?.likes ?? 0;
  if (likes < MIN_LIKES) return false;
  const views = stats?.views ?? 0;
  if (views > 0) {
    const engaged = likes + (stats?.comments ?? 0) + (stats?.shares ?? 0);
    if (engaged / views < MIN_ENGAGEMENT_RATE) return false;
  }
  return true;
}

// Every run reserves memory out of one account-wide pool (16GB on Apify's lower tiers) and these
// actors default to 4096MB each, so fanning out several at once used to blow the cap and come
// back "402 actor-memory-limit-exceeded" on whichever runs started last. Pinning each run's memory
// (must be a power of two) keeps the whole fan-out inside the pool: 3 TikTok + 1 Instagram here
// peaks at ~5GB instead of 24GB.
async function runApifyActor(
  actorId: string,
  input: Record<string, unknown>,
  memoryMb: number
): Promise<unknown[]> {
  const res = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items` +
      `?token=${APIFY_API_TOKEN}&timeout=90&memory=${memoryMb}`,
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

// One call per region — this actor reads TikTok's own Trend Discovery, which is inherently
// per-country, so there's no way to ask it for "CIS + Europe + US" in a single run. The CIS call
// gets the largest quota because that's the feed's first-priority region.
//
// The `region` field name (and the country codes it accepts) is this integration's best guess at
// the actor's current input shape, NOT confirmed against a live run — same caveat as the rest of
// this file. If a run errors or comes back empty, open apify.com/clockworks/tiktok-trends-scraper
// → Input to see the field's real name/allowed values and fix it here.
const TIKTOK_REGIONS: { code: string; region: Region; limit: number }[] = [
  { code: 'KZ', region: 'cis', limit: 12 },
  { code: 'DE', region: 'europe', limit: 8 },
  { code: 'US', region: 'america', limit: 6 },
];

async function fetchTikTokRegion(code: string, region: Region, limit: number): Promise<TrendItem[]> {
  // 1GB is plenty for this one — it reads TikTok's trend-discovery API rather than driving a
  // browser, and three of these run side by side.
  const items = await runApifyActor('clockworks~tiktok-trends-scraper', {
    region: code,
    resultsPerPage: limit,
  }, 1024);
  return items
    .map((raw): TrendItem => {
      const item = raw as Record<string, unknown>;
      const author = item.authorMeta as Record<string, unknown> | undefined;
      const video = item.videoMeta as Record<string, unknown> | undefined;
      return {
        platform: 'tiktok',
        region,
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
    })
    .filter((item) => isTrend(item.stats))
    .slice(0, limit);
}

async function fetchTikTokTrends(): Promise<TrendItem[]> {
  const runs = await Promise.allSettled(
    TIKTOK_REGIONS.map(({ code, region, limit }) => fetchTikTokRegion(code, region, limit))
  );
  const failures = runs.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  // One dead region shouldn't lose the other two — only a total wipeout is worth failing on.
  if (failures.length === runs.length) throw new Error(String(failures[0].reason));
  if (failures.length > 0) console.error('tiktok: some regions failed', failures.map((f) => String(f.reason)));
  return runs.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
}

// Instagram has no per-country "trending" endpoint this actor can read, so region is approximated
// by which language's hashtags the post carries — Russian-language tags for CIS, English ones for
// Europe/America. The hashtag is only the *discovery* route and a region hint, never the bar for
// inclusion: every post still has to clear MIN_LIKES + MIN_ENGAGEMENT_RATE, which is what actually
// makes it a trend.
//
// Ordered by region priority, because instagramRegion() below takes the first tag a post matches
// and a post tagged both #рекомендации and #viral should count as CIS.
const INSTAGRAM_TAG_REGIONS: { tag: string; region: Region }[] = [
  { tag: 'рекомендации', region: 'cis' },
  { tag: 'тренды', region: 'cis' },
  { tag: 'рек', region: 'cis' },
  { tag: 'viral', region: 'europe' },
  { tag: 'trending', region: 'europe' },
  { tag: 'fyp', region: 'america' },
  { tag: 'explorepage', region: 'america' },
];

// Per hashtag page. All seven pages go through a single actor run (see the memory note on
// runApifyActor), so the run returns roughly this many times seven — deliberately far more than
// we keep, since a hashtag feed is mostly ordinary posts and isTrend throws most of them away.
const INSTAGRAM_RESULTS_PER_TAG = 40;
const INSTAGRAM_KEEP = 24;

function instagramRegion(item: Record<string, unknown>): Region {
  const hashtags = Array.isArray(item.hashtags) ? item.hashtags.map((h) => String(h).toLowerCase()) : [];
  const caption = String(item.caption ?? '').toLowerCase();
  for (const { tag, region } of INSTAGRAM_TAG_REGIONS) {
    if (hashtags.includes(tag) || caption.includes(`#${tag}`)) return region;
  }
  return 'unknown';
}

async function fetchInstagramTrends(): Promise<TrendItem[]> {
  // apify/instagram-scraper (the official actor) takes explore-page URLs rather than a keyword
  // search — an earlier version of this function called a third-party actor
  // (apidojo~instagram-scraper-api) with a `search`/`searchType` pair it doesn't actually support,
  // which made every run fail with "run-failed". directUrls is this actor's documented, stable way
  // to pull posts under a hashtag, and it takes every tag in one run.
  const items = await runApifyActor(
    'apify~instagram-scraper',
    {
      directUrls: INSTAGRAM_TAG_REGIONS.map(
        ({ tag }) => `https://www.instagram.com/explore/tags/${encodeURIComponent(tag)}/`
      ),
      resultsType: 'posts',
      resultsLimit: INSTAGRAM_RESULTS_PER_TAG,
    },
    2048
  );
  return items
    .map((raw): TrendItem => {
      const item = raw as Record<string, unknown>;
      return {
        platform: 'instagram',
        region: instagramRegion(item),
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
    })
    .filter((item) => isTrend(item.stats))
    // Region ordering is applied by the panel via region_rank; here we only decide which 24
    // survive, and that's purely on engagement.
    .sort((a, b) => popularityScore(b.stats) - popularityScore(a.stats))
    .slice(0, INSTAGRAM_KEEP);
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
const THREADS_MAX_ITEMS = 8;

function toRegion(value: unknown): Region {
  return value === 'cis' || value === 'europe' || value === 'america' ? (value as Region) : 'unknown';
}

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
            'Ты — аналитик соцсети Threads (Meta, threads.net). Через веб-поиск найди до 8 постов или ' +
            'обсуждений, которые РЕАЛЬНО ОПУБЛИКОВАНЫ и обсуждаются именно в Threads за последние ' +
            'несколько дней. ЗАПРЕЩЕНО: посты и ссылки из Twitter/X, общие новостные темы дня, любые ' +
            'источники не с threads.net — если находишь такое, не включай в ответ вообще, лучше верни ' +
            'меньше пунктов или пустой массив, чем подмени их Twitter-трендами или новостями. ' +
            'БЕРИ ТОЛЬКО ВИРАЛЬНОЕ: пост должен иметь заметную вовлечённость (тысячи лайков и ответов, ' +
            'массовое обсуждение), обычные посты с единичными лайками не нужны. ' +
            'ПРИОРИТЕТ РЕГИОНОВ: сначала СНГ (Казахстан, Россия, русскоязычные авторы), затем Европа, ' +
            'затем США. Не заполняй ответ контентом из Индии и Юго-Восточной Азии. ' +
            'Ответь СТРОГО валидным JSON-массивом без markdown-разметки и без пояснений, схема каждого ' +
            'элемента: {"title": "...", "description": "...", "source_url": "https://threads.net/...", ' +
            '"author": "...", "region": "cis" | "europe" | "america"}. source_url обязателен, должен ' +
            'вести именно на threads.net и быть реальной ссылкой из результатов поиска, а не выдуманной. ' +
            'region — регион автора поста.',
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
    .slice(0, THREADS_MAX_ITEMS)
    .map((item): TrendItem => ({
      platform: 'threads',
      // Threads reports no engagement numbers at all here, so isTrend() can't gate these the way
      // it gates TikTok/Instagram — the "must be viral" rule lives in the prompt instead, and the
      // region below is the model's own answer rather than something measured.
      region: toRegion(item.region),
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

// The panel has an admin-only "Обновить"/"Refresh" button that calls this function's public URL
// directly with the anon key — which is public in the client bundle by design, so anyone who
// reads it out could script repeated calls. This cooldown is the real guard (the button's own
// admin-only gating is UI-level only): refuse to spend on Apify/OpenRouter again this soon after
// the last successful run, cron or manual.
const MANUAL_REFRESH_COOLDOWN_MINUTES = 10;

// The admin "Обновить"/"Refresh" button calls this function directly from the browser (not
// server-to-server like cron/curl), so it needs CORS headers — without them the browser's
// preflight OPTIONS request gets no Access-Control-Allow-* headers back and blocks the real
// POST before it's ever sent, which looks like the button just hanging forever.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  try {
    const { data: lastRun } = await supabaseAdmin
      .from('trend_watch_items')
      .select('fetched_at')
      .order('fetched_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (lastRun && Date.now() - new Date(lastRun.fetched_at).getTime() < MANUAL_REFRESH_COOLDOWN_MINUTES * 60_000) {
      return new Response(JSON.stringify({ inserted: 0, errors: [], skipped: 'cooldown' }), {
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }

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
          region: item.region,
          region_rank: REGION_RANK[item.region],
        }))
      );
      if (error) throw error;
    }

    // Enforce the "50 trends/day, most popular kept" retention promise — usually a no-op now that
    // the MIN_LIKES gate throws most scraped posts away, but a real safety net if this function is
    // ever invoked more than once for the same fetch_date.
    const today = new Date().toISOString().slice(0, 10);
    const { data: todaysItems, error: trimSelectError } = await supabaseAdmin
      .from('trend_watch_items')
      .select('id')
      .eq('fetch_date', today)
      // Same ordering the panel reads with, so the 50 that survive are the 50 actually shown
      // first — CIS ahead of Europe ahead of America, most popular first inside each region.
      .order('region_rank', { ascending: true })
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
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  } catch (err) {
    console.error('trendswatch-refresh failed', err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }
});
