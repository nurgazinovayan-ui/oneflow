// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-upload-file" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically.
//
// multipart/form-data body: channelId (text field) + file (the file itself).
// Uploads to the "messenger-files" Storage bucket (created by
// 202609090001_messenger_read_files.sql — must be applied first) under a per-channel, per-upload
// random path, then inserts a kind:'file' message pointing at it, same "validate + write in one
// service-role call" shape as messenger-send-message. Membership and eligibility are both
// re-checked here against the caller's own verified JWT before either the upload or the insert.
//
// Requires supabase/migrations/202609070003_messenger.sql, 202609070004_messenger_media.sql AND
// 202609090001_messenger_read_files.sql to have been applied first.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MECHTA_DOMAIN = '@mechta.kz';
const ADMIN_EMAIL = 'nurgazinov.ayan@gmail.com';
function isAllowed(email: string): boolean {
  return email.endsWith(MECHTA_DOMAIN) || email === ADMIN_EMAIL;
}
const MAX_FILE_BYTES = 25 * 1024 * 1024; // matches the bucket's own file_size_limit
const BUCKET = 'messenger-files';

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

// Keeps the object path readable in the Storage browser while stripping anything that isn't
// safe in a URL path segment — the original name is preserved separately in the message body
// for display, this is only ever used for the storage key.
function safeFilename(name: string): string {
  const trimmed = name.trim().slice(-140);
  const cleaned = trimmed.replace(/[^a-zA-Z0-9._-]+/g, '_');
  return cleaned || 'file';
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

    const form = await req.formData().catch(() => null);
    if (!form) return jsonError('Ожидается multipart/form-data.', 400);
    const channelId = String(form.get('channelId') ?? '');
    const file = form.get('file');
    if (!channelId) return jsonError('channelId обязателен.', 400);
    if (!(file instanceof File)) return jsonError('Файл обязателен.', 400);
    if (file.size <= 0) return jsonError('Пустой файл.', 400);
    if (file.size > MAX_FILE_BYTES) return jsonError('Файл больше 25 МБ.', 400);

    const { data: membership, error: memErr } = await admin
      .from('messenger_members')
      .select('email')
      .eq('channel_id', channelId)
      .eq('email', callerEmail)
      .maybeSingle();
    if (memErr) throw memErr;
    if (!membership) return jsonError('Вы не участник этого чата.', 403);

    const originalName = file.name || 'file';
    const objectPath = `${channelId}/${crypto.randomUUID()}-${safeFilename(originalName)}`;
    const { error: uploadErr } = await admin.storage.from(BUCKET).upload(objectPath, file, {
      contentType: file.type || 'application/octet-stream',
      upsert: false,
    });
    if (uploadErr) throw uploadErr;

    const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(objectPath);

    const { data: created, error: insertErr } = await admin
      .from('messenger_messages')
      .insert({
        channel_id: channelId,
        sender_email: callerEmail,
        body: originalName.slice(0, 4000),
        kind: 'file',
        media_url: pub.publicUrl,
        file_size: file.size,
      })
      .select('id, sender_email, body, created_at, kind, media_url, file_size')
      .single();
    if (insertErr) throw insertErr;

    return new Response(
      JSON.stringify({
        id: created.id, senderEmail: created.sender_email, body: created.body, createdAt: created.created_at,
        kind: created.kind, mediaUrl: created.media_url, fileSize: created.file_size,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    return jsonError(String(err), 500);
  }
});
