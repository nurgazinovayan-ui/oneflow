// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "yandex-project-upload" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No extra secrets needed beyond SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (auto-injected).
//
// Saves the caller's whole project (nodes/edges JSON, not a generated media file) to their own
// Yandex Disk, under /ONEFLOW. Unlike yandex-disk-upload (which points Yandex's servers at a
// Replicate URL for them to fetch), there's no public URL for arbitrary project JSON — this
// function uses Yandex Disk's own two-step "get an upload href, then PUT the bytes to it" flow
// instead, so it can push inline content straight from the request body.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

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

    const { fileName, content } = await req.json();
    if (!fileName || typeof content !== 'string') {
      return new Response(JSON.stringify({ error: 'Не переданы fileName/content.' }), {
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

    await ensureFolder(row.access_token);

    const diskPath = `${BACKUP_FOLDER}/${fileName}`;
    const hrefRes = await fetch(
      `https://cloud-api.yandex.net/v1/disk/resources/upload?path=${encodeURIComponent(diskPath)}&overwrite=true`,
      { headers: { Authorization: `OAuth ${row.access_token}` } }
    );
    const hrefData = await hrefRes.json().catch(() => ({}) as Record<string, unknown>);
    if (!hrefRes.ok) {
      return new Response(
        JSON.stringify({ error: (hrefData as { message?: string }).message || 'Не удалось получить ссылку для загрузки.' }),
        { status: hrefRes.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { href, method } = hrefData as { href?: string; method?: string };
    if (!href) {
      return new Response(JSON.stringify({ error: 'Яндекс Диск не вернул ссылку для загрузки.' }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const putRes = await fetch(href, {
      method: method || 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: content,
    });
    if (!putRes.ok && putRes.status !== 201) {
      return new Response(JSON.stringify({ error: `Не удалось загрузить файл на Диск (${putRes.status}).` }), {
        status: putRes.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

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
