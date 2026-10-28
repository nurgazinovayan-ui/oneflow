// ---- User assets — generated from supabase/functions/_shared/user_assets.ts by
// scripts/sync-edge-guard.mjs. Edit that file and re-run the script; do not edit this copy by hand.
//
// Every finished generation is kept for its owner, so it shows up again after a reload and on any
// device (the Assets panel and the Generation history read it back through the user-assets
// function): the file in storage and a user_assets row that says whose it is. Images go to the
// private user-generations bucket; a video already lives in the video bucket and only gets the row.
// Keeping is best effort: a failure is logged and the user still gets the result.
const ASSET_BUCKET = 'user-generations';
const ASSET_IMAGE_TYPES: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };
const ASSET_MAX_BYTES = 50 * 1024 * 1024;
interface AssetInfo {
  model: string;
  prompt?: string;
  meta?: Record<string, unknown>;
}

// The bytes of a provider result: inline base64, or an https link the provider hosts.
async function assetBytes(src: string): Promise<{ bytes: Uint8Array; mime: string } | null> {
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',');
    const m = /^data:([a-z0-9.+/-]+)(;[a-z0-9=.+-]+)*;base64$/i.exec(src.slice(0, comma));
    if (!m || comma < 0) return null;
    const bin = atob(src.slice(comma + 1));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime: m[1].toLowerCase() };
  }
  if (!isPublicHttpsUrl(src)) return null; // a provider link, never an internal address
  const res = await fetchWithTimeout(src, {}, 60_000);
  if (!res.ok || Number(res.headers.get('content-length') ?? '0') > ASSET_MAX_BYTES) return null;
  const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime };
}

async function recordAsset(userId: string, kind: 'image' | 'video', bucket: string, path: string, mime: string, bytes: number | null, info: AssetInfo): Promise<void> {
  const { error } = await supabaseAdmin.from('user_assets').insert({
    user_id: userId,
    kind,
    bucket,
    path,
    mime,
    bytes,
    model: String(info.model ?? '').slice(0, 120),
    prompt: String(info.prompt ?? '').slice(0, 4000),
    meta: info.meta ?? {},
  });
  if (error) throw error;
}

async function keepImageAsset(userId: string, src: string, info: AssetInfo): Promise<void> {
  try {
    const got = await assetBytes(src);
    const ext = got ? ASSET_IMAGE_TYPES[got.mime] : undefined;
    if (!got || !ext || got.bytes.length > ASSET_MAX_BYTES) {
      console.error('asset not kept: not a png/jpeg/webp under 50 MB');
      return;
    }
    const path = `${userId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await supabaseAdmin.storage.from(ASSET_BUCKET).upload(path, got.bytes, { contentType: got.mime, upsert: false });
    if (error) throw error;
    try {
      await recordAsset(userId, 'image', ASSET_BUCKET, path, got.mime, got.bytes.length, info);
    } catch (err) {
      await supabaseAdmin.storage.from(ASSET_BUCKET).remove([path]); // no file without its owner
      throw err;
    }
  } catch (err) {
    console.error('asset not kept', String(err).slice(0, 300));
  }
}

async function keepVideoAsset(userId: string, bucket: string, path: string, bytes: number | null, info: AssetInfo): Promise<void> {
  try {
    await recordAsset(userId, 'video', bucket, path, 'video/mp4', bytes, info);
  } catch (err) {
    console.error('asset not kept', String(err).slice(0, 300));
  }
}
