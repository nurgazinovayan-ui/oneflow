// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "yandex-oauth-exchange" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// Secrets needed (Edge Functions → yandex-oauth-exchange → Secrets):
//   YANDEX_CLIENT_ID, YANDEX_CLIENT_SECRET — from the OAuth app registered at oauth.yandex.ru.
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
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token ?? null,
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
