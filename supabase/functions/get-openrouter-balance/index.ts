// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "get-openrouter-balance" → paste this file → Deploy. Keep "Verify JWT" ON (default) — this
// still only makes sense for a signed-in user, even though the number returned is the same for
// everyone (see below).
//
// Powers the web BudgetBar's real balance display — the actual OpenRouter account wallet, not
// any total this app tracks itself. There's one shared OPENROUTER_API_KEY funding every
// generation (see the generate-*/evaluate-creative functions), topped up directly at
// openrouter.ai, so "budget" here means that one shared wallet, not a per-user figure.
//
// Needs a SEPARATE secret from OPENROUTER_API_KEY: that inference key can only report its own
// rate-limit/usage via GET /api/v1/key, not the account-wide credit balance. The balance
// (GET /api/v1/credits — total_credits minus total_usage) requires a Provisioning API Key, a
// different kind of key OpenRouter issues for account/key management rather than inference.
//
// Set up once:
//   1. openrouter.ai → Settings → Provisioning Keys → Create Key.
//   2. Edge Functions → get-openrouter-balance → Secrets → add OPENROUTER_PROVISIONING_KEY
//      with that key's value. (SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are already set
//      automatically for every Edge Function in this project.)

import { createClient } from 'npm:@supabase/supabase-js@2';

const OPENROUTER_PROVISIONING_KEY = Deno.env.get('OPENROUTER_PROVISIONING_KEY') ?? '';
const OPENROUTER_CREDITS_URL = 'https://openrouter.ai/api/v1/credits';

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

    const res = await fetch(OPENROUTER_CREDITS_URL, {
      headers: { Authorization: `Bearer ${OPENROUTER_PROVISIONING_KEY}` },
    });
    if (!res.ok) throw new Error(`OpenRouter credits error ${res.status}: ${await res.text()}`);
    const { data } = await res.json();
    const totalCredits = typeof data?.total_credits === 'number' ? data.total_credits : 0;
    const totalUsage = typeof data?.total_usage === 'number' ? data.total_usage : 0;

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
