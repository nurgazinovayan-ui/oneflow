// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "admin-send-message" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically — the dashboard actively refuses to
// let you set a secret with the SUPABASE_ prefix yourself, which is expected, not an error.
//
// Body: { mode: 'all', message } broadcasts to every account except the caller; or
// { mode: 'selected', emails: string[], message } targets just those addresses (any that don't
// resolve to a real account are silently skipped, not an error, as long as at least one does).

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Only this account may send admin messages. The client hides the "Отправить сообщение"
// button for everyone else, but that's just UX — this check is what actually enforces it,
// against the caller's own verified JWT rather than anything the client claims.
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

    const body: { mode?: 'all' | 'selected'; emails?: string[]; message?: string } = await req.json();
    const mode = body.mode === 'all' ? 'all' : 'selected';
    const message = body.message?.trim();
    if (!message) {
      return new Response(JSON.stringify({ error: 'Укажите текст сообщения.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (mode === 'selected' && (!body.emails || body.emails.length === 0)) {
      return new Response(JSON.stringify({ error: 'Укажите хотя бы одного получателя.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // There's no direct "get users by email" in the admin API, so page through listUsers()
    // once, collecting everyone — fine for a small user base. Reused below for both modes.
    const allUsers: { id: string; email: string }[] = [];
    for (let page = 1; page <= 50; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      allUsers.push(...data.users.map((u) => ({ id: u.id, email: (u.email ?? '').toLowerCase() })));
      if (data.users.length < 200) break;
    }

    let targetIds: string[];
    if (mode === 'all') {
      targetIds = allUsers.filter((u) => u.id !== caller.id).map((u) => u.id);
    } else {
      const wanted = new Set(body.emails!.map((e) => e.trim().toLowerCase()));
      targetIds = allUsers.filter((u) => wanted.has(u.email)).map((u) => u.id);
    }
    if (targetIds.length === 0) {
      return new Response(JSON.stringify({ error: 'Получатели не найдены.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: insertError } = await admin
      .from('admin_messages')
      .insert(targetIds.map((id) => ({ target_user_id: id, body: message })));
    if (insertError) throw insertError;
    await auditAdmin(admin, 'send_message', caller.id, { mode, recipients: targetIds.length });

    return new Response(JSON.stringify({ ok: true, count: targetIds.length }), {
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
