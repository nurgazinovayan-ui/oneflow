// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-roster" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically.
//
// Returns every eligible account (any @mechta.kz address, plus the app owner's own account),
// not just the ones who have already opened the messenger — this needs the Auth Admin API
// (auth.admin.listUsers), which only the service role can call, to see the full account list.
// Left-joined against messenger_profiles for display name/status/last-seen; an account that has
// never opened the widget gets a default display name (its email's local part), status "idle",
// and online: false. Restricted to eligible callers, checked against the caller's own verified
// JWT.
//
// Requires supabase/migrations/202609070003_messenger.sql to have been applied first.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MECHTA_DOMAIN = '@mechta.kz';
const ADMIN_EMAIL = 'nurgazinov.ayan@gmail.com';
function isAllowed(email: string): boolean {
  return email.endsWith(MECHTA_DOMAIN) || email === ADMIN_EMAIL;
}

// The widget heartbeats roughly every 20s while open; anything quieter than this has almost
// certainly closed the widget (or the tab) rather than just being between polls.
const ONLINE_WINDOW_SECONDS = 45;
const USERS_PER_PAGE = 1000;
const MAX_PAGES = 10; // 10k accounts is far beyond this internal tool's real scale; caps a runaway loop

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
    if (!caller || !isAllowed(callerEmail)) {
      return new Response(JSON.stringify({ error: 'Доступ запрещён.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const allowedEmails = new Set<string>();
    for (let page = 1; page <= MAX_PAGES; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: USERS_PER_PAGE });
      if (error) throw error;
      for (const u of data.users) {
        const e = u.email?.toLowerCase();
        if (e && isAllowed(e)) allowedEmails.add(e);
      }
      if (data.users.length < USERS_PER_PAGE) break;
    }

    const { data: profiles, error } = await admin
      .from('messenger_profiles')
      .select('email, display_name, status, last_seen_at');
    if (error) throw error;
    const profileByEmail = new Map((profiles ?? []).map((p: { email: string }) => [p.email, p]));

    const since = Date.now() - ONLINE_WINDOW_SECONDS * 1000;
    const roster = [...allowedEmails]
      .map((email) => {
        const p = profileByEmail.get(email) as { display_name: string; status: string; last_seen_at: string } | undefined;
        return {
          email,
          displayName: p?.display_name || email.split('@')[0],
          status: p?.status ?? 'idle',
          online: p ? new Date(p.last_seen_at).getTime() >= since : false,
          isSelf: email === callerEmail,
        };
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));

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
