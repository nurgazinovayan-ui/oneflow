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

// ---- Admin check — generated from supabase/functions/_shared/admin_check.ts by
// scripts/sync-edge-guard.mjs (the admin-api / admin-send-message copies in the admin repo carry the
// same block). Edit the shared file, not this copy.
//
// Admin = a confirmed account whose e-mail is in ADMIN_EMAILS (comma separated secret; defaults to
// the owner). With ADMIN_REQUIRE_MFA=1 the session must also have passed MFA: the JWT, already
// verified by auth.getUser before this runs, carries aal2 (Supabase Auth → MFA → TOTP).
const ADMIN_EMAILS = (Deno.env.get('ADMIN_EMAILS') ?? 'nurgazinov.ayan@gmail.com')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);
function jwtClaim(token: string, claim: string): unknown {
  try {
    const part = token.split('.')[1] ?? '';
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(atob(b64))?.[claim];
  } catch {
    return undefined;
  }
}
function isAdminUser(user: { email?: string | null; email_confirmed_at?: string | null } | null | undefined, token: string): boolean {
  if (!user || !user.email_confirmed_at || !ADMIN_EMAILS.includes((user.email ?? '').toLowerCase())) return false;
  if (Deno.env.get('ADMIN_REQUIRE_MFA') === '1' && jwtClaim(token, 'aal') !== 'aal2') return false;
  return true;
}
// Every administrative action leaves a row in security_events (who, what, on whom; never secrets).
type AuditClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: unknown }> };
async function auditAdmin(client: AuditClient, action: string, actorId: string, details: Record<string, unknown>): Promise<void> {
  const { error } = await client.rpc('log_security_event', {
    p_kind: `admin_${action}`.slice(0, 60),
    p_severity: 'info',
    p_user: actorId,
    p_details: details,
    p_dedupe: null,
  });
  if (error) console.error('audit log failed', error);
}
// ---- end of admin check

// The shared OpenRouter account balance is business data: admins only (audit F-07). It used to
// answer every signed-in user.
async function isAdminRequest(req: Request): Promise<boolean> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return false;
  return isAdminUser(data.user, token);
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
    if (!(await isAdminRequest(req))) {
      return new Response(JSON.stringify({ error: 'Доступ запрещён.' }), {
        status: 403,
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
    console.error(err);  // audit L-2: details stay in the function logs
    return new Response(JSON.stringify({ error: 'Внутренняя ошибка. Попробуйте ещё раз.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
