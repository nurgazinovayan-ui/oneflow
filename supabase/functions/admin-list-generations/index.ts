// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "admin-list-generations" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically — the dashboard actively refuses to
// let you set a secret with the SUPABASE_ prefix yourself, which is expected, not an error.
//
// Only this account may call this — same enforcement pattern as admin-send-message/
// admin-list-online, checked against the caller's own verified JWT. Reads generation_log,
// which each generate-*/evaluate-creative Edge Function writes one row to after a successful,
// balance-deducted generation — but ALWAYS returns rows only for accounts whose email ends in
// "@mechta.kz", regardless of who else's generations are in the table. That filter lives here
// server-side, not in the client UI, so it can't be bypassed by calling the function directly.
//
// Requires the generation_log table — run this once in Supabase Studio's SQL editor:
//
//   create table if not exists generation_log (
//     id uuid primary key default gen_random_uuid(),
//     user_id uuid not null references auth.users(id) on delete cascade,
//     email text not null,
//     model text not null,
//     category text not null,
//     cost_usd numeric not null default 0,
//     created_at timestamptz not null default now()
//   );
//   alter table generation_log enable row level security;
//   -- Only Edge Functions (service-role, which bypasses RLS) ever write to this table. The one
//   -- select policy below lets a signed-in user read their own rows directly (via their own JWT,
//   -- not service-role) — used by the web BudgetBar (src/webApi.ts's fetchMonthlySpend) to show
//   -- real spend instead of a client-estimated running total. This function itself still reads
//   -- via service-role regardless, so it isn't affected either way.
//   create policy "select own generation log" on generation_log
//     for select using (auth.uid() = user_id);
//   create index if not exists generation_log_email_idx on generation_log (email);
//   create index if not exists generation_log_created_at_idx on generation_log (created_at desc);
//   create index if not exists generation_log_user_id_idx on generation_log (user_id);

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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
const MECHTA_DOMAIN = '@mechta.kz';
const MAX_ROWS = 2000;

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

    const { data, error } = await admin
      .from('generation_log')
      .select('email, model, category, cost_usd, created_at')
      .ilike('email', `%${MECHTA_DOMAIN}`)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw error;

    const rows = (data ?? []).map((r) => ({
      email: r.email as string,
      model: r.model as string,
      category: r.category as string,
      costUsd: (r.cost_usd as number) ?? 0,
      createdAt: r.created_at as string,
    }));

    return new Response(JSON.stringify(rows), {
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
