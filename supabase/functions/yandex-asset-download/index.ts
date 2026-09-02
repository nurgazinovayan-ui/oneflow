// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "yandex-asset-download" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No extra secrets needed beyond SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (auto-injected).
//
// Backs the "Ассеты" panel's actual image/video rendering (src/components/AssetsPanel.tsx).
// yandex-list-assets hands back each file's `file` field (Yandex's own temporary direct-
// download link) on the assumption the browser could load it directly as an <img>/<video> src
// — in practice that link doesn't reliably render cross-origin (whatever the exact reason on
// Yandex's end — hotlink/Referer checks, an expired-by-render-time TTL, or something else),
// which is exactly the bug this function fixes: it fetches the real bytes server-side (using
// the stored OAuth token, the same way yandex-list-assets does) and streams them straight back
// to the caller with the correct Content-Type, so the browser only ever talks to our own
// origin. webApi.ts turns the response into a blob: URL for the <img>/<video> src.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

    const { path } = (await req.json()) as { path?: string };
    if (!path) {
      return new Response(JSON.stringify({ error: 'Missing path.' }), {
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

    // Two-step, same as the official flow: ask for a fresh signed download link, then fetch it.
    // Doing this per-request (rather than reusing yandex-list-assets' `file` field) sidesteps
    // any TTL-expiry-by-render-time issue on top of fixing the direct-embed problem.
    const linkUrl = `https://cloud-api.yandex.net/v1/disk/resources/download?path=${encodeURIComponent(path)}`;
    const linkRes = await fetch(linkUrl, { headers: { Authorization: `OAuth ${row.access_token}` } });
    const linkData = await linkRes.json().catch(() => ({}) as Record<string, unknown>);
    if (!linkRes.ok) {
      return new Response(
        JSON.stringify({ error: (linkData as { message?: string }).message || 'Не удалось получить ссылку на файл.' }),
        { status: linkRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    const href = (linkData as { href?: string }).href;
    if (!href) {
      return new Response(JSON.stringify({ error: 'Yandex did not return a download link.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const fileRes = await fetch(href);
    if (!fileRes.ok || !fileRes.body) {
      return new Response(JSON.stringify({ error: 'Не удалось загрузить файл с Яндекс Диска.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const contentType = fileRes.headers.get('content-type') ?? 'application/octet-stream';
    return new Response(fileRes.body, {
      headers: { ...corsHeaders, 'Content-Type': contentType },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
