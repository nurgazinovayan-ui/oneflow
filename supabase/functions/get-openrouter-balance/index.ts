// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "get-openrouter-balance" → paste this file → Deploy. Keep "Verify JWT" ON (default) — this
// still only makes sense for a signed-in user, even though the number returned is the same for
// everyone (see below). No new secret needed: reuses the same OPENROUTER_API_KEY every
// generate-*/evaluate-creative function already has configured.
//
// Powers the web BudgetBar's real balance display — the actual OpenRouter account, not any
// total this app tracks itself. There's one shared OPENROUTER_API_KEY funding every generation,
// topped up directly at openrouter.ai, so "budget" here means that one shared key's usage, not
// a per-user figure.
//
// GET /api/v1/key reports usage (real, all-time credits spent on this key — accurate as long as
// this is the only key ever used on the account, which it is here) and limit (a credit cap you
// can optionally set ON THIS KEY in OpenRouter's dashboard — openrouter.ai/settings/keys → edit
// this key → "Credit limit" — null if you never set one). Without that cap set, "totalCredits"
// below comes back 0 and the BudgetBar falls back to its own default ceiling instead of your
// real top-up amount; set the key's credit limit to match what you've actually funded (e.g. 5)
// if you want the bar's denominator to be accurate too, not just the spent amount.
//
// (The full account-wide credit balance — GET /api/v1/credits, total ever purchased minus total
// spent — needs a separate Provisioning API Key instead of this inference key. Skipped here
// since that page isn't in every account's Settings the same way; this simpler route needs no
// extra setup.)

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? '';
const OPENROUTER_KEY_URL = 'https://openrouter.ai/api/v1/key';

const supabaseAdmin = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

async function getCaller(req: Request): Promise<{ id: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

// The web build is served from a different origin than *.supabase.co, so every browser call
// here is cross-origin and triggers a CORS preflight (OPTIONS) first — without these headers
// on both the preflight and the real response, the browser blocks the request before it ever
// reaches this function.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Not authenticated.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const res = await fetch(OPENROUTER_KEY_URL, {
      headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
    });
    if (!res.ok) throw new Error(`OpenRouter key error ${res.status}: ${await res.text()}`);
    const { data } = await res.json();
    const totalUsage = typeof data?.usage === 'number' ? data.usage : 0;
    const totalCredits = typeof data?.limit === 'number' ? data.limit : 0;

    return new Response(JSON.stringify({ totalCredits, totalUsage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
