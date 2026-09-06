// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "yandex-oauth-exchange" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secrets needed (Edge Functions → yandex-oauth-exchange → Secrets):
//   YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET — from the OAuth app registered at oauth.yandex.ru.
//   YANDEX_TOKEN_ENCRYPTION_KEY — a random 32-byte AES-256 key, base64-encoded (generate once
//     with e.g. `openssl rand -base64 32`), used to encrypt access_token/refresh_token before
//     they're written to user_yandex_tokens — see encryptToken/decryptToken below. Set the SAME
//     value on every Edge Function that touches this table (this one plus yandex-disk-upload,
//     yandex-project-upload, yandex-list-assets, yandex-asset-download) — a mismatch means those
//     other functions can no longer decrypt tokens this one writes.
//
// Also needs a table (SQL editor → run once):
//   create table if not exists user_yandex_tokens (
//     user_id uuid primary key references auth.users(id) on delete cascade,
//     access_token text not null,
//     refresh_token text,
//     expires_at timestamptz,
//     updated_at timestamptz default now()
//   );
//   alter table user_yandex_tokens enable row level security;
// No policies needed — only this function and yandex-disk-upload touch the table, both via the
// service-role client below, which bypasses RLS entirely.
//
// The app's Yandex OAuth app was registered without a custom redirect URI (it uses Yandex's
// own "verification_code" display page), so the user copy-pastes the code shown there into the
// app rather than being redirected back automatically — this function just needs that code,
// not a redirect_uri to match.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const YANDEX_CLIENT_ID = Deno.env.get('YANDEX_CLIENT_ID') ?? '';
const YANDEX_CLIENT_SECRET = Deno.env.get('YANDEX_CLIENT_SECRET') ?? '';
const TOKEN_ENCRYPTION_KEY_B64 = Deno.env.get('YANDEX_TOKEN_ENCRYPTION_KEY') ?? '';

// Security-review follow-up (point 4, "доступы пользователей в базе зашифрованы"): these are
// real OAuth credentials giving access to a user's own Yandex Disk, so they're encrypted with
// AES-256-GCM before ever reaching the database — RLS keeps other users out, but this also
// protects them against a leaked SUPABASE_SERVICE_ROLE_KEY or a raw DB snapshot/backup. A fresh
// random IV per encryption is required for GCM (reusing an IV with the same key breaks its
// security guarantees), so it's generated per call and stored alongside the ciphertext rather
// than reused.
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

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

async function encryptToken(plaintext: string): Promise<string> {
  const key = await getAesKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  );
  return `${toBase64(iv)}.${toBase64(ciphertext)}`;
}

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
    if (!caller) {
      return new Response(JSON.stringify({ error: 'Не выполнен вход.' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { code } = await req.json();
    if (!code) {
      return new Response(JSON.stringify({ error: 'Код авторизации не передан.' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tokenRes = await fetch('https://oauth.yandex.ru/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code: String(code),
        client_id: YANDEX_CLIENT_ID,
        client_secret: YANDEX_CLIENT_SECRET,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) {
      return new Response(
        JSON.stringify({ error: tokenData.error_description || tokenData.error || 'Не удалось обменять код на токен.' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const expiresAt = new Date(Date.now() + (tokenData.expires_in ?? 3600) * 1000).toISOString();
    const { error: upsertError } = await admin.from('user_yandex_tokens').upsert({
      user_id: caller.id,
      access_token: await encryptToken(tokenData.access_token),
      refresh_token: tokenData.refresh_token ? await encryptToken(tokenData.refresh_token) : null,
      expires_at: expiresAt,
      updated_at: new Date().toISOString(),
    });
    if (upsertError) throw upsertError;

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
