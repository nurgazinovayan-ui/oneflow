// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-send-message" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically.
//
// Body: { channelId: string, text: string }. Membership and the @mechta.kz domain are both
// re-checked here against the caller's own verified JWT before the insert — the client can
// only ever reach a channel it was already added to via messenger-create-channel.
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
const MAX_BODY_LENGTH = 4000;

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
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!channelId) return jsonError('channelId обязателен.', 400);
    if (!text || text.length > MAX_BODY_LENGTH) return jsonError(`Сообщение должно быть от 1 до ${MAX_BODY_LENGTH} символов.`, 400);

    const { data: membership, error: memErr } = await admin
      .from('messenger_members')
      .select('email')
      .eq('channel_id', channelId)
      .eq('email', callerEmail)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!membership) return jsonError('Вы не участник этого чата.', 403);

    const { data: created, error: insertErr } = await admin
      .from('messenger_messages')
      .insert({ channel_id: channelId, sender_email: callerEmail, body: text })
      .select('id, sender_email, body, created_at')
      .single();
    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({ id: created.id, senderEmail: created.sender_email, body: created.body, createdAt: created.created_at }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return jsonError(String(err), 500);
  }
});
