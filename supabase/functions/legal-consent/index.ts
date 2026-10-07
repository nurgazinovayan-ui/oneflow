// Deploy in Supabase Studio → Edge Functions → Create a new function → name it "legal-consent" →
// paste this file → Deploy. Keep "Verify JWT" ON (default). Requires
// supabase/migrations/202610070001_legal_consent.sql.
//
// Acceptance of the Terms of Service + Privacy Policy for the signed-in caller (ConsentModal):
//   { action: 'status' }                                  → { accepted, version }
//   { action: 'accept', version, context, details? }      → { ok: true }
// context: 'signup' (Google sign-up accepted before the redirect), 'login' (an account without the
// current edition, once after login), 'payment' (before every payment). The record keeps the edition,
// time, IP and browser. A client on an older edition gets 409 legal_outdated and asks for a reload.
// The future checkout function must refuse to start a payment unless has_legal_consent(user) is true.

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const CONTEXTS = new Set(['signup', 'login', 'payment']);
const MAX_PAYMENT_RECORDS_PER_HOUR = 30;

// Only a few known, typed fields are kept from the client — never free-form JSON.
function cleanDetails(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const d = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof d.amountUsd === 'number' && Number.isFinite(d.amountUsd) && d.amountUsd >= 0 && d.amountUsd <= 100000) out.amountUsd = d.amountUsd;
  if (typeof d.credits === 'number' && Number.isInteger(d.credits) && d.credits >= 0 && d.credits <= 10_000_000) out.credits = d.credits;
  if (typeof d.plan === 'string' && /^[a-z]{1,20}$/.test(d.plan)) out.plan = d.plan;
  if (d.period === 'month' || d.period === 'year') out.period = d.period;
  return Object.keys(out).length ? out : null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData, error: userError } = token ? await supabaseAdmin.auth.getUser(token) : { data: { user: null }, error: null };
    const user = userData?.user;
    if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

    const body = await req.json().catch(() => ({}));
    const { data: setting, error: sErr } = await supabaseAdmin.from('app_settings').select('value').eq('key', 'legal_version').single();
    if (sErr) throw sErr;
    const version = Number(setting.value);

    if (body.action === 'status') {
      const { data, error } = await supabaseAdmin.rpc('has_legal_consent', { p_user: user.id });
      if (error) throw error;
      return json({ accepted: data === true, version });
    }

    if (body.action === 'accept') {
      const context = String(body.context ?? '');
      if (!CONTEXTS.has(context)) return json({ error: 'Bad context.' }, 400);
      if (Number(body.version) !== version) return json({ error: 'legal_outdated', code: 'legal_outdated' }, 409);

      if (context === 'payment') {
        const since = new Date(Date.now() - 3600_000).toISOString();
        const { count, error } = await supabaseAdmin.from('legal_consents').select('id', { count: 'exact', head: true })
          .eq('user_id', user.id).eq('context', 'payment').gte('accepted_at', since);
        if (error) throw error;
        if ((count ?? 0) >= MAX_PAYMENT_RECORDS_PER_HOUR) return json({ error: 'Too many requests.' }, 429);
      } else {
        // signup / login: one record per edition is enough
        const { data: has, error } = await supabaseAdmin.rpc('has_legal_consent', { p_user: user.id });
        if (error) throw error;
        if (has === true) return json({ ok: true });
      }

      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim().slice(0, 64) || null;
      const userAgent = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;
      const { error } = await supabaseAdmin.from('legal_consents').insert({
        user_id: user.id, version, context, ip, user_agent: userAgent, details: cleanDetails(body.details),
      });
      if (error) throw error;
      return json({ ok: true });
    }

    return json({ error: 'Unknown action.' }, 400);
  } catch (err) {
    console.error(err); // details stay in the function logs
    return json({ error: 'Внутренняя ошибка. Попробуйте ещё раз.' }, 500);
  }
});
