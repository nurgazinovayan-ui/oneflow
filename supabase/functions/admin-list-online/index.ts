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
const ADMIN_EMAIL = 'nurgazinov.ayan@gmail.com';

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
    if (!caller || caller.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
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
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
