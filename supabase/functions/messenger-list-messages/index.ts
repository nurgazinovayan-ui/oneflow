// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-list-messages" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically.
//
// Body: { channelId: string, after?: string (ISO timestamp) }
// Without "after", returns the most recent MAX_MESSAGES messages (ascending). With "after",
// returns only messages newer than it — the widget polls with its last-seen message's
// createdAt while open. Membership is re-checked here against the caller's own verified JWT;
// messenger_messages carries no RLS write/read policy beyond SELECT for members, and this
// function additionally guards against a non-member polling a channelId they don't belong to.
//
// Requires supabase/migrations/202609070003_messenger.sql, 202609070004_messenger_media.sql AND
// 202609090001_messenger_read_files.sql to have been applied first.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
// Any signed-in account with an email may use the messenger (it was @mechta.kz + the owner only
// until 202609240001_messenger_contacts.sql). What a caller can actually read or write is scoped
// by channel membership, checked below; who can start a chat with whom is decided in
// messenger-create-channel.
function isAllowed(email: string): boolean {
  return email.includes('@');
}
const MAX_MESSAGES = 200;

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
    const after = typeof body?.after === 'string' ? body.after : null;
    if (!channelId) return jsonError('channelId обязателен.', 400);

    const { data: membership, error: memErr } = await admin
      .from('messenger_members')
      .select('email')
      .eq('channel_id', channelId)
      .eq('email', callerEmail)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!membership) return jsonError('Вы не участник этого чата.', 403);

    let query = admin
      .from('messenger_messages')
      .select('id, sender_email, body, created_at, kind, media_url, file_size')
      .eq('channel_id', channelId)
      .order('created_at', { ascending: after ? true : false })
      .limit(MAX_MESSAGES);
    if (after) query = query.gt('created_at', after);
    const { data, error } = await query;
    if (error) throw error;

    const messages = (after ? data ?? [] : [...(data ?? [])].reverse()).map(
      (m: { id: string; sender_email: string; body: string; created_at: string; kind: string; media_url: string | null; file_size: number | null }) => ({
        id: m.id,
        senderEmail: m.sender_email,
        body: m.body,
        createdAt: m.created_at,
        kind: m.kind,
        mediaUrl: m.media_url,
        fileSize: m.file_size,
      })
    );

    return new Response(JSON.stringify(messages), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(String(err), 500);
  }
});
