// Deploy in Supabase Studio → Edge Functions → Create a new function → name it "get-credits" →
// paste this file → Deploy. Keep "Verify JWT" ON (default). Requires
// supabase/migrations/202610060001_credits.sql.
//
// The caller's own credit balance for the budget bar and the top-up slider: unexpired credits,
// credits held by running generations, the soonest expiry, and the top-up price tiers (read from
// app_settings, the same numbers credits_for_topup() uses, so the slider never disagrees with what
// a payment would credit). Replaces get-openrouter-balance on the client: users no longer see the
// shared provider wallet.
// → { available, reserved, activeTotal, nextExpiryAt, nextExpiryCredits, unlimited, topup: { minUsd, maxUsd, tiers } }

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const TOPUP_KEYS = ['topup_min_usd', 'topup_max_usd', 'credits_per_usd', 'topup_tier2_from_usd', 'credits_per_usd_tier2', 'topup_tier3_from_usd', 'credits_per_usd_tier3'];

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: userData, error: userError } = token ? await supabaseAdmin.auth.getUser(token) : { data: { user: null }, error: null };
    const user = userData?.user;
    if (userError || !user) return json({ error: 'Not authenticated.' }, 401);

    const { data: rows, error } = await supabaseAdmin.rpc('credit_balance', { p_user: user.id });
    if (error) throw error;
    const b = (Array.isArray(rows) ? rows[0] : rows) ?? {};

    const { data: settings, error: sErr } = await supabaseAdmin.from('app_settings').select('key, value').in('key', TOPUP_KEYS);
    if (sErr) throw sErr;
    const s = Object.fromEntries((settings ?? []).map((r: { key: string; value: number }) => [r.key, Number(r.value)]));

    return json({
      available: Number(b.available ?? 0),
      reserved: Number(b.reserved ?? 0),
      activeTotal: Number(b.active_total ?? 0),
      nextExpiryAt: b.next_expiry_at ?? null,
      nextExpiryCredits: b.next_expiry_credits ?? null,
      unlimited: Boolean(b.unlimited),
      topup: {
        minUsd: s.topup_min_usd ?? 10,
        maxUsd: s.topup_max_usd ?? 500,
        tiers: [
          { fromUsd: s.topup_min_usd ?? 10, perUsd: s.credits_per_usd ?? 50 },
          { fromUsd: s.topup_tier2_from_usd ?? 50, perUsd: s.credits_per_usd_tier2 ?? 55 },
          { fromUsd: s.topup_tier3_from_usd ?? 200, perUsd: s.credits_per_usd_tier3 ?? 60 },
        ],
      },
    });
  } catch (err) {
    console.error(err); // audit L-2: details stay in the function logs
    return json({ error: 'Внутренняя ошибка. Попробуйте ещё раз.' }, 500);
  }
});
