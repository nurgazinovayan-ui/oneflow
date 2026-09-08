// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-gif-search" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure for Supabase itself: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// reserved names Supabase injects automatically. You DO need to add one secret yourself:
//   GIPHY_API_KEY — a free key from https://developers.giphy.com (Create an App → API key).
//   Set it in Supabase Studio → Edge Functions → Manage secrets (or `supabase secrets set
//   GIPHY_API_KEY=...` via the CLI). Without it this function returns a clear config error
//   instead of a confusing Giphy 401.
//
// Body: { query?: string, limit?: number }. Empty/omitted query returns Giphy's trending feed.
// Proxied so the API key never reaches the browser. Rating capped at "pg" (workplace tool, no
// search-term filtering beyond what Giphy itself applies at that rating). Only returns the
// handful of fields the widget needs, never Giphy's full response. Restricted to eligible
// callers, checked against the caller's own verified JWT — same as every other messenger
// function, even though this one is read-only, to avoid spending the shared Giphy quota on
// anyone who isn't allowed into the messenger at all.

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GIPHY_API_KEY = Deno.env.get('GIPHY_API_KEY') ?? '';
const MECHTA_DOMAIN = '@mechta.kz';
const ADMIN_EMAIL = 'nurgazinov.ayan@gmail.com';
function isAllowed(email: string): boolean {
  return email.endsWith(MECHTA_DOMAIN) || email === ADMIN_EMAIL;
}
const MAX_LIMIT = 24;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    if (!GIPHY_API_KEY) return jsonError('GIPHY_API_KEY не настроен на сервере.', 500);

    // createClient is only needed to verify the caller's JWT; importing the full supabase-js
    // client just for auth.getUser would work too, but a direct call to Supabase's own auth
    // endpoint keeps this function's only external dependency to Giphy plus Deno's fetch.
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_ROLE_KEY, Authorization: `Bearer ${token}` },
    });
    if (!userRes.ok) return jsonError('Доступ запрещён.', 403);
    const user = await userRes.json();
    const callerEmail = user?.email?.toLowerCase() ?? '';
    if (!callerEmail || !isAllowed(callerEmail)) return jsonError('Доступ запрещён.', 403);

    const body = await req.json().catch(() => ({}));
    const query = typeof body?.query === 'string' ? body.query.trim().slice(0, 100) : '';
    const limit = Math.min(Math.max(Number(body?.limit) || MAX_LIMIT, 1), MAX_LIMIT);

    const giphyUrl = new URL(query ? 'https://api.giphy.com/v1/gifs/search' : 'https://api.giphy.com/v1/gifs/trending');
    giphyUrl.searchParams.set('api_key', GIPHY_API_KEY);
    giphyUrl.searchParams.set('limit', String(limit));
    giphyUrl.searchParams.set('rating', 'pg');
    if (query) giphyUrl.searchParams.set('q', query);

    const giphyRes = await fetch(giphyUrl);
    if (!giphyRes.ok) return jsonError(`Giphy вернул ошибку (${giphyRes.status}).`, 502);
    const giphyData = await giphyRes.json();

    type GiphyItem = { id: string; title: string; images: { fixed_width_small?: { url: string }; fixed_width?: { url: string }; original: { url: string } } };
    const results = ((giphyData?.data ?? []) as GiphyItem[]).map((g) => ({
      id: g.id,
      title: g.title || 'GIF',
      previewUrl: g.images.fixed_width_small?.url ?? g.images.fixed_width?.url ?? g.images.original.url,
      url: g.images.original.url,
    }));

    return new Response(JSON.stringify(results), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(String(err), 500);
  }
});
