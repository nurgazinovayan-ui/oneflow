// The caller's own generations, kept by generate-image / generate-video / generate-video-pro
// (user_assets + the private user-generations bucket, see migration 202610280002). Backs the
// "Ассеты" panel and the Generation history, so what a user made is there after a reload and on any
// device they sign in from. Keep "Verify JWT" ON (the router checks it as for every function).
//
//   { action: 'list', kind?: 'image' | 'video', before?: ISO time, limit?: 1..60 }
//       → { items: [{ id, kind, url, model, prompt, meta, createdAt }], next: ISO time | null }
//       images come with a signed link valid for a day; videos with their public link
//   { action: 'delete', id }  → { ok: true }   the file and its row; only the owner's own

import { createClient } from 'npm:@supabase/supabase-js@2';

const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SIGNED_LINK_SECONDS = 24 * 60 * 60;
const MAX_PAGE = 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

async function getCaller(req: Request): Promise<{ id: string } | null> {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) return null;
  return { id: data.user.id };
}

interface AssetRow {
  id: string;
  kind: 'image' | 'video';
  bucket: string;
  path: string;
  model: string;
  prompt: string;
  meta: Record<string, unknown>;
  created_at: string;
}

async function list(userId: string, params: Record<string, unknown>): Promise<Response> {
  const kind = params.kind === 'image' || params.kind === 'video' ? params.kind : null;
  const before = typeof params.before === 'string' && !Number.isNaN(Date.parse(params.before)) ? params.before : null;
  const limit = Math.min(MAX_PAGE, Math.max(1, Math.floor(Number(params.limit) || 30)));
  let q = supabaseAdmin
    .from('user_assets')
    .select('id, kind, bucket, path, model, prompt, meta, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (kind) q = q.eq('kind', kind);
  if (before) q = q.lt('created_at', before);
  const { data, error } = await q;
  if (error) throw error;
  const rows = (data ?? []) as AssetRow[];
  const page = rows.slice(0, limit);

  // images: one signing call per bucket for the whole page; videos: their public link
  const signed = new Map<string, string>();
  const byBucket = new Map<string, string[]>();
  for (const r of page) if (r.kind === 'image') byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), r.path]);
  for (const [bucket, paths] of byBucket) {
    const { data: links, error: signError } = await supabaseAdmin.storage.from(bucket).createSignedUrls(paths, SIGNED_LINK_SECONDS);
    if (signError) throw signError;
    for (const l of links ?? []) if (l.path && l.signedUrl && !l.error) signed.set(`${bucket}/${l.path}`, l.signedUrl);
  }
  const items = page
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      url: r.kind === 'image' ? signed.get(`${r.bucket}/${r.path}`) ?? null : supabaseAdmin.storage.from(r.bucket).getPublicUrl(r.path).data.publicUrl,
      model: r.model,
      prompt: r.prompt,
      meta: r.meta ?? {},
      createdAt: r.created_at,
    }))
    .filter((i) => i.url); // a file that is gone is not shown
  return jsonResponse({ items, next: rows.length > limit ? page[page.length - 1].created_at : null });
}

async function remove(userId: string, params: Record<string, unknown>): Promise<Response> {
  const id = typeof params.id === 'string' && UUID.test(params.id) ? params.id : null;
  if (!id) return jsonResponse({ error: 'Не указано, что удалить.', code: 'bad_request' }, 400);
  const { data, error } = await supabaseAdmin.from('user_assets').select('bucket, path').eq('id', id).eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data) return jsonResponse({ error: 'Файл не найден.', code: 'not_found' }, 404);
  const { error: fileError } = await supabaseAdmin.storage.from(data.bucket).remove([data.path]);
  if (fileError) throw fileError;
  const { error: rowError } = await supabaseAdmin.from('user_assets').delete().eq('id', id).eq('user_id', userId);
  if (rowError) throw rowError;
  return jsonResponse({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const caller = await getCaller(req);
    if (!caller) return jsonResponse({ error: 'Not authenticated.' }, 401);
    if (Number(req.headers.get('content-length') ?? '0') > 10_000) return jsonResponse({ error: 'Запрос слишком большой.', code: 'payload_too_large' }, 413);
    const params = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!params || typeof params !== 'object') return jsonResponse({ error: 'Bad request.', code: 'bad_request' }, 400);
    if (params.action === 'list') return await list(caller.id, params);
    if (params.action === 'delete') return await remove(caller.id, params);
    return jsonResponse({ error: 'Unknown action.', code: 'bad_request' }, 400);
  } catch (err) {
    console.error('user-assets failed', String(err).slice(0, 300));
    return jsonResponse({ error: 'Не удалось загрузить ваши материалы. Попробуйте ещё раз.' }, 500);
  }
});
