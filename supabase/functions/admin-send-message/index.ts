// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "admin-send-message" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically — the dashboard actively refuses to
// let you set a secret with the SUPABASE_ prefix yourself, which is expected, not an error.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

// Only this account may send admin messages. The client hides the "Отправить сообщение"
// button for everyone else, but that's just UX — this check is what actually enforces it,
// against the caller's own verified JWT rather than anything the client claims.
const ADMIN_EMAIL = 'nurgazinov.ayan@gmail.com';

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

    const body: { email?: string; message?: string } = await req.json();
    const targetEmail = body.email?.trim().toLowerCase();
    const message = body.message?.trim();
    if (!targetEmail || !message) {
      return new Response(JSON.stringify({ error: 'Укажите email и текст сообщения.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // There's no direct "get user by email" in the admin API, so page through listUsers()
    // until a match turns up — fine for a small user base.
    let targetId: string | null = null;
    for (let page = 1; page <= 20 && !targetId; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      const match = data.users.find((u) => u.email?.toLowerCase() === targetEmail);
      if (match) targetId = match.id;
      if (data.users.length < 200) break;
    }
    if (!targetId) {
      return new Response(JSON.stringify({ error: 'Пользователь с таким email не найден.' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { error: insertError } = await admin
      .from('admin_messages')
      .insert({ target_user_id: targetId, body: message });
    if (insertError) throw insertError;

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
