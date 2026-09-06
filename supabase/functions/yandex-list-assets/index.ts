// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "yandex-list-assets" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secret needed beyond SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (auto-injected):
//   YANDEX_TOKEN_ENCRYPTION_KEY — same value as set on yandex-oauth-exchange, which encrypts
//   the tokens this function reads. See that function's header comment for details.
//
// Backs the "Ассеты" panel (see src/components/AssetsPanel.tsx) — lists the image/video files
// under the caller's /ONEFLOW folder (the same folder yandex-disk-upload/yandex-project-upload
// write to) and hands back Yandex's own temporary direct-download link for each one, so the
// browser can render/download them without this function proxying any bytes itself.

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

const ASSETS_FOLDER = '/ONEFLOW';
const FIELDS =
  '_embedded.items.name,_embedded.items.path,_embedded.items.file,_embedded.items.mime_type,' +
  '_embedded.items.media_type,_embedded.items.size,_embedded.items.created,_embedded.items.type';

interface YandexItem {
  name: string;
  path: string;
  file?: string;
  mime_type?: string;
  media_type?: string;
  size?: number;
  created?: string;
  type: string;
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
    const listUrl =
      `https://cloud-api.yandex.net/v1/disk/resources?path=${encodeURIComponent(ASSETS_FOLDER)}` +
      `&limit=1000&fields=${encodeURIComponent(FIELDS)}`;
    const listRes = await fetch(listUrl, { headers: { Authorization: `OAuth ${accessToken}` } });

    // A 404 just means the folder hasn't been created yet (nothing saved there so far) — that's
    // an empty gallery, not an error.
    if (listRes.status === 404) {
      return new Response(JSON.stringify({ assets: [] }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const listData = await listRes.json().catch(() => ({}) as Record<string, unknown>);
    if (!listRes.ok) {
      return new Response(
        JSON.stringify({ error: (listData as { message?: string }).message || 'Не удалось получить список файлов.' }),
        { status: listRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const items = ((listData as { _embedded?: { items?: YandexItem[] } })._embedded?.items ?? []) as YandexItem[];
    const assets = items
      .filter((i) => i.type === 'file' && (i.media_type === 'image' || i.media_type === 'video') && i.file)
      .map((i) => ({
        name: i.name,
        path: i.path,
        url: i.file as string,
        mediaType: i.media_type as 'image' | 'video',
        mimeType: i.mime_type ?? '',
        size: i.size ?? 0,
        created: i.created ?? '',
      }))
      .sort((a, b) => (a.created < b.created ? 1 : -1));

    return new Response(JSON.stringify({ assets }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
