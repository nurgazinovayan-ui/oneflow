// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-roster" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically.
//
// Returns every @mechta.kz colleague who has ever opened the messenger widget (i.e. has a
// messenger_profiles row), with an "online" flag derived from how recently messenger-heartbeat
// last touched their row. Restricted to @mechta.kz callers, checked against the caller's own
// verified JWT.
//
// Requires supabase/migrations/202609070003_messenger.sql to have been applied first.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MECHTA_DOMAIN = '@mechta.kz';

// The widget heartbeats roughly every 20s while open; anything quieter than this has almost
// certainly closed the widget (or the tab) rather than just being between polls.
const ONLINE_WINDOW_SECONDS = 45;

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
    const callerEmail = caller?.email?.toLowerCase() ?? '';
    if (!caller || !callerEmail.endsWith(MECHTA_DOMAIN)) {
      return new Response(JSON.stringify({ error: 'Доступ запрещён.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await admin
      .from('messenger_profiles')
      .select('email, display_name, last_seen_at')
      .order('display_name', { ascending: true });
    if (error) throw error;

    const since = Date.now() - ONLINE_WINDOW_SECONDS * 1000;
    const roster = (data ?? []).map((r: { email: string; display_name: string; last_seen_at: string }) => ({
      email: r.email,
      displayName: r.display_name || r.email.split('@')[0],
      online: new Date(r.last_seen_at).getTime() >= since,
      isSelf: r.email === callerEmail,
    }));

    return new Response(JSON.stringify(roster), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
