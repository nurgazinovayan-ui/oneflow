// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "yandex-disk-upload" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed beyond SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (auto-injected):
//   YANDEX_TOKEN_ENCRYPTION_KEY — same value as set on yandex-oauth-exchange, which encrypts
//   the tokens this function reads. See that function's header comment for details.
//
// Backs up one generated file to the caller's own Yandex Disk, under /ONEFLOW — uses Yandex
// Disk's "upload from URL" endpoint so Yandex's servers fetch the file directly from Replicate
// rather than this function proxying the bytes itself.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const TOKEN_ENCRYPTION_KEY_B64 = Deno.env.get('YANDEX_TOKEN_ENCRYPTION_KEY') ?? '';

function fromBase64(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function getAesKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(TOKEN_ENCRYPTION_KEY_B64), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

// Rows written before encryption was added are plain text (no "iv.ciphertext" shape) — decrypt
// falls back to returning them as-is rather than erroring, so already-connected accounts keep
// working; the next time yandex-oauth-exchange writes this user's tokens, they're encrypted.
async function decryptToken(stored: string): Promise<string> {
  const parts = stored.split('.');
  if (parts.length !== 2) return stored;
  try {
    const key = await getAesKey();
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(parts[0]) },
      key,
      fromBase64(parts[1])
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    return stored;
  }
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const BACKUP_FOLDER = '/ONEFLOW';

// Best-effort — 201 means the folder was just created, 409 means it already exists, both are
// fine; the upload call below is what actually needs to succeed.
async function ensureFolder(accessToken: string): Promise<void> {
  try {
    await fetch(`https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(BACKUP_FOLDER)}`, {
      method: 'PUT',
      headers: { Authorization: `OAuth ${accessToken}` },
    });
  } catch {
    // Fall through to the upload attempt regardless.
  }
}

// Yandex downloads sourceUrl itself; still only plain public https URLs are accepted (no credentials,
// no IP literals, no internal-looking hosts).
function isPublicHttpsUrl(v: unknown): v is string {
  if (typeof v !== 'string' || v.length > 4096) return false;
  try {
    const u = new URL(v);
    const host = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || !host.includes('.')) return false;
    if (host.startsWith('[') || /^[\d.]+$/.test(host) || /(^|\.)(localhost|local|internal)$/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
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
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Не выполнен вход.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { sourceUrl, fileName } = await req.json();
    if (!isPublicHttpsUrl(sourceUrl) || typeof fileName !== 'string' || fileName.length > 200) {
      return new Response(JSON.stringify({ error: 'Не переданы sourceUrl/fileName.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: row, error: selectError } = await admin
      .from('user_yandex_tokens')
      .select('access_token')
      .eq('user_id', caller.id)
      .maybeSingle();
    if (selectError) throw selectError;
    if (!row) {
      return new Response(JSON.stringify({ error: 'Яндекс Диск не подключен.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const accessToken = await decryptToken(row.access_token);
    await ensureFolder(accessToken);

    const diskPath = `${BACKUP_FOLDER}/${fileName}`;
    const uploadUrl =
      `https://cloud-api.yandex.net/v1/disk/resources/upload?` +
      `path=${encodeURIComponent(diskPath)}&url=${encodeURIComponent(sourceUrl)}&overwrite=true`;
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: { Authorization: `OAuth ${accessToken}` },
    });
    const uploadData = await uploadRes.json().catch(() => ({}) as Record<string, unknown>);
    if (!uploadRes.ok) {
      return new Response(
        JSON.stringify({ error: (uploadData as { message?: string }).message || 'Не удалось загрузить файл на Диск.' }),
        { status: uploadRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error(err);  // audit L-2: details stay in the function logs
    return new Response(JSON.stringify({ error: 'Внутренняя ошибка. Попробуйте ещё раз.' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
