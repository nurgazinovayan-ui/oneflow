// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "admin-list-online" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically — the dashboard actively refuses to
// let you set a secret with the SUPABASE_ prefix yourself, which is expected, not an error.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Only this account may see who's online. The client hides the admin panel for everyone
// else, but that's just UX — this check is what actually enforces it, against the caller's
// own verified JWT rather than anything the client claims.
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

// A client heartbeats roughly every 45s (see AdminMessageToast.tsx); anything quieter than
// this has almost certainly closed the app rather than just being between polls.
const ONLINE_WINDOW_MINUTES = 3;

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
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    const { data: callerData } = await admin.auth.getUser(token);
    const caller = callerData.user;
    // Audit M-2: the owner's address must also be confirmed — an unconfirmed sign-up proves nothing.
    if (!caller || !isAdminUser(caller, token)) {
      return new Response(JSON.stringify({ error: 'Доступ запрещён.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const since = new Date(Date.now() - ONLINE_WINDOW_MINUTES * 60_000).toISOString();
    const { data, error } = await admin
      .from('presence')
      .select('email, last_seen')
      .gte('last_seen', since)
      .order('last_seen', { ascending: false });
    if (error) throw error;

    const online = (data ?? []).map((r: { email: string; last_seen: string }) => ({
      email: r.email,
      lastSeen: r.last_seen,
    }));
    return new Response(JSON.stringify(online), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);  // audit L-2: details stay in the logs
    return new Response(JSON.stringify({ error: 'Внутренняя ошибка.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
