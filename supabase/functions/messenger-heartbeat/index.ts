// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-heartbeat" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically — the dashboard actively refuses to
// let you set a secret with the SUPABASE_ prefix yourself, which is expected, not an error.
//
// Called every ~20s while the messenger widget is open (see src/messenger/client.ts), and once
// with a display name when the user first sets one. Restricted to @mechta.kz accounts, checked
// against the caller's own verified JWT rather than anything the client claims. Writing through
// the service role rather than a direct REST upsert from the client sidesteps RLS-on-upsert
// entirely (see public.presence in supabase/schema.sql — that turned out unreliable in
// practice) and keeps display_name from being blanked out by a routine heartbeat that didn't
// resend it.
//
// Requires supabase/migrations/202609070003_messenger.sql to have been applied first.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MECHTA_DOMAIN = '@mechta.kz';

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
    const email = caller?.email?.toLowerCase() ?? '';
    if (!caller || !email.endsWith(MECHTA_DOMAIN)) {
      return new Response(JSON.stringify({ error: 'Доступ запрещён.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const body = await req.json().catch(() => ({}));
    const displayName = typeof body?.displayName === 'string' ? body.displayName.trim().slice(0, 120) : '';
    const now = new Date().toISOString();

    if (displayName) {
      const { error } = await admin
        .from('messenger_profiles')
        .upsert({ email, display_name: displayName, last_seen_at: now }, { onConflict: 'email' });
      if (error) throw error;
    } else {
      const { data: existing } = await admin.from('messenger_profiles').select('email').eq('email', email).maybeSingle();
      if (existing) {
        const { error } = await admin.from('messenger_profiles').update({ last_seen_at: now }).eq('email', email);
        if (error) throw error;
      } else {
        const { error } = await admin
          .from('messenger_profiles')
          .insert({ email, display_name: email.split('@')[0], last_seen_at: now });
        if (error) throw error;
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
