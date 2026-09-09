// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-mark-read" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically.
//
// Body: { channelId: string }
// Stamps the caller's own messenger_members.last_read_at to now() for that channel — read by
// messenger-list-channels/messenger-list-messages so other members can see their sent messages
// were read (a message is "read" once every other member's last_read_at is >= its created_at).
// Called by the widget whenever a channel is opened or new messages arrive while it's open.
//
// Requires supabase/migrations/202609070003_messenger.sql AND 202609090001_messenger_read_files.sql
// to have been applied first.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MECHTA_DOMAIN = '@mechta.kz';
const ADMIN_EMAIL = 'nurgazinov.ayan@gmail.com';
function isAllowed(email: string): boolean {
  return email.endsWith(MECHTA_DOMAIN) || email === ADMIN_EMAIL;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

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
    if (!caller || !isAllowed(callerEmail)) return jsonError('Доступ запрещён.', 403);

    const body = await req.json().catch(() => ({}));
    const channelId = typeof body?.channelId === 'string' ? body.channelId : '';
    if (!channelId) return jsonError('channelId обязателен.', 400);

    const { data: updated, error } = await admin
      .from('messenger_members')
      .update({ last_read_at: new Date().toISOString() })
      .eq('channel_id', channelId)
      .eq('email', callerEmail)
      .select('channel_id')
      .maybeSingle();
    if (error) throw error;
    if (!updated) return jsonError('Вы не участник этого чата.', 403);

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(String(err), 500);
  }
});
