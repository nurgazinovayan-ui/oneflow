// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-send-message" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically.
//
// Body: { channelId: string, kind?: 'text' | 'sticker' | 'gif', text?: string, mediaUrl?: string }
// kind defaults to 'text'. 'sticker' stores a short emoji string in body (no external asset).
// 'gif' requires an HTTPS mediaUrl (see messenger-gif-search) and allows an empty body/caption.
// Membership and eligibility are both re-checked here against the caller's own verified JWT
// before the insert — the client can only ever reach a channel it was already added to via
// messenger-create-channel.
//
// Requires supabase/migrations/202609070003_messenger.sql AND
// 202609070004_messenger_media.sql to have been applied first.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MECHTA_DOMAIN = '@mechta.kz';
const ADMIN_EMAIL = 'nurgazinov.ayan@gmail.com';
function isAllowed(email: string): boolean {
  return email.endsWith(MECHTA_DOMAIN) || email === ADMIN_EMAIL;
}
const MAX_BODY_LENGTH = 4000;
const MAX_STICKER_LENGTH = 16; // room for multi-codepoint emoji (ZWJ sequences, skin tone modifiers)

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

function httpsUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const u = new URL(value);
    if (u.protocol !== 'https:' || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
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
    const kind = body?.kind === 'sticker' ? 'sticker' : body?.kind === 'gif' ? 'gif' : 'text';
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    const mediaUrl = kind === 'gif' ? httpsUrl(body?.mediaUrl) : null;
    if (!channelId) return jsonError('channelId обязателен.', 400);
    if (kind === 'gif') {
      if (!mediaUrl) return jsonError('mediaUrl должен быть HTTPS-ссылкой.', 400);
      if (text.length > MAX_BODY_LENGTH) return jsonError(`Подпись должна быть не длиннее ${MAX_BODY_LENGTH} символов.`, 400);
    } else if (kind === 'sticker') {
      if (!text || text.length > MAX_STICKER_LENGTH) return jsonError(`Стикер должен быть от 1 до ${MAX_STICKER_LENGTH} символов.`, 400);
    } else {
      if (!text || text.length > MAX_BODY_LENGTH) return jsonError(`Сообщение должно быть от 1 до ${MAX_BODY_LENGTH} символов.`, 400);
    }

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
      .insert({ channel_id: channelId, sender_email: callerEmail, body: text, kind, media_url: mediaUrl })
      .select('id, sender_email, body, created_at, kind, media_url')
      .single();
    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({
        id: created.id, senderEmail: created.sender_email, body: created.body, createdAt: created.created_at,
        kind: created.kind, mediaUrl: created.media_url,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return jsonError(String(err), 500);
  }
});
