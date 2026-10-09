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
// Any signed-in account with an email may use the messenger (it was @mechta.kz + the owner only
// until 202609240001_messenger_contacts.sql). What a caller can actually read or write is scoped
// by channel membership, checked below; who can start a chat with whom is decided in
// messenger-create-channel.
function isAllowed(email: string): boolean {
  return email.includes('@');
}
const MAX_FILE_BYTES = 25 * 1024 * 1024; // matches the bucket's own file_size_limit
const BUCKET = 'messenger-files';

// messenger-files is a private bucket (202610090001_security_hardening.sql): stored rows keep the
// object path in a public-style URL, and every reader gets a short-lived signed download link.
const SIGNED_URL_TTL_SECONDS = 12 * 60 * 60;
const PUBLIC_MARKER = `/object/public/${BUCKET}/`;
function objectPathOf(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null;
  const i = mediaUrl.indexOf(PUBLIC_MARKER);
  return i < 0 ? null : decodeURIComponent(mediaUrl.slice(i + PUBLIC_MARKER.length));
}

// Per-account limit shared by every function instance (rate_limit_hit in Postgres). A limiter outage
// must not stop people from chatting, so errors let the request through (and are logged).
type RpcClient = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: unknown }> };
async function retryAfterSeconds(client: RpcClient, bucket: string, limit: number, windowSeconds: number): Promise<number> {
  const { data, error } = await client.rpc('rate_limit_hit', { p_bucket: bucket, p_limit: limit, p_window_seconds: windowSeconds });
  if (error) {
    console.error('rate_limit_hit failed', error);
    return 0;
  }
  return Number(data) || 0;
}

// The stored Content-Type comes from the file's own first bytes, never from the browser: anything
// that is not a known safe format is stored as application/octet-stream (no HTML/SVG/script can be
// served as a page from our storage domain), and every link is a download (audit F-04).
async function sniffContentType(file: File): Promise<string> {
  const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  const at = (i: number, ...bytes: number[]) => bytes.every((x, k) => b[i + k] === x);
  const ascii = (i: number, s: string) => at(i, ...[...s].map((c) => c.charCodeAt(0)));
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF8')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  if (ascii(0, '%PDF-')) return 'application/pdf';
  if (ascii(4, 'ftyp')) return 'video/mp4';
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return 'video/webm';
  if (ascii(0, 'ID3') || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
  if (ascii(0, 'RIFF') && ascii(8, 'WAVE')) return 'audio/wav';
  if (ascii(0, 'OggS')) return 'audio/ogg';
  if (at(0, 0x50, 0x4b, 0x03, 0x04)) return 'application/zip'; // also docx/xlsx/pptx
  return 'application/octet-stream';
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

    // uploads per account: 20 a minute
    const wait = await retryAfterSeconds(admin, `messenger-upload:${caller.id}`, 20, 60);
    if (wait > 0) {
      return new Response(JSON.stringify({ error: 'Слишком много файлов подряд. Подождите минуту.' }), {
        status: 429,
        headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Retry-After': String(wait) },
      });
    }
    if (Number(req.headers.get('content-length') ?? '0') > MAX_FILE_BYTES + 1024 * 1024) return jsonError('Файл больше 25 МБ.', 413);

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
    // Raw bytes, not the File: for a File/Blob supabase-js ignores contentType and sends the type the
    // browser claimed, which is exactly what must not decide how the file is served.
    const { error: uploadErr } = await admin.storage.from(BUCKET).upload(objectPath, await file.arrayBuffer(), {
      contentType: await sniffContentType(file),
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

    const { data: signed } = await admin.storage.from(BUCKET).createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS, { download: true });
    return new Response(
      JSON.stringify({
        id: created.id, senderEmail: created.sender_email, body: created.body, createdAt: created.created_at,
        kind: created.kind, mediaUrl: signed?.signedUrl ?? null, fileSize: created.file_size,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err) {
    console.error(err);  // audit L-2: details stay in the function logs
    return jsonError('Внутренняя ошибка. Попробуйте ещё раз.', 500);
  }
});
