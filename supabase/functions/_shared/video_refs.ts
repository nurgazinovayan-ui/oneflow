// ---- Video references — generated from supabase/functions/_shared/video_refs.ts by
// scripts/sync-edge-guard.mjs. Edit that file and re-run the script; do not edit this copy by hand.
//
// OpenRouter takes exact frames in frame_images ({ type: 'image_url', image_url: { url },
// frame_type }) and guidance in input_references (the same entries without frame_type, plus
// video_url / input_audio). Video references must be https URLs (data: URLs are refused), so every
// image and video the app sends inline is first stored in the public video bucket under refs/ and
// passed by URL; the files are removed once the job is over. Audio goes inline as input_audio; a
// provider that refuses it gets the same request again without the audio.
const REF_DIR = 'refs';
const REF_TYPES: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
};
const AUDIO_FORMATS: Record<string, string> = {
  'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav',
  'audio/ogg': 'ogg', 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/flac': 'flac',
};
type VideoRefEntry =
  | { type: 'image_url'; image_url: { url: string }; frame_type?: 'first_frame' | 'last_frame' }
  | { type: 'video_url'; video_url: { url: string } }
  | { type: 'input_audio'; input_audio: { data: string; format: string } };

function splitDataUrl(v: string): { mime: string; base64: string } | null {
  const comma = v.indexOf(',');
  const m = /^data:([a-z0-9.+/-]+)(;[a-z0-9=.+-]+)*;base64$/i.exec(v.slice(0, comma));
  return m && comma > 0 ? { mime: m[1].toLowerCase(), base64: v.slice(comma + 1) } : null;
}

// Why a reference cannot go to the model, in words for the user; null when it can. Checked before
// any money is reserved, so a file the model would never see is refused with a reason instead of
// being dropped on the way.
const REF_PROBLEM = {
  image: { what: 'Фото', formats: 'JPG, PNG или WebP' },
  video: { what: 'Видео', formats: 'MP4, WebM или MOV' },
  audio: { what: 'Аудио', formats: 'MP3, WAV, M4A, OGG или FLAC' },
};
function refProblem(v: unknown, kind: 'image' | 'video' | 'audio'): string | null {
  const { what, formats } = REF_PROBLEM[kind];
  if (typeof v !== 'string' || !v) return `${what} не прочиталось — прикрепите файл ещё раз.`;
  if (v.length > MAX_IMAGE_REF_CHARS) return `${what} больше 9 МБ — уменьшите файл и прикрепите снова.`;
  if (!v.startsWith('data:')) {
    return kind !== 'audio' && isPublicHttpsUrl(v) ? null : `${what} недоступно по ссылке — прикрепите файл.`;
  }
  const d = splitDataUrl(v);
  const known = d && (kind === 'audio' ? AUDIO_FORMATS[d.mime] : REF_TYPES[d.mime] && d.mime.startsWith(`${kind}/`));
  return known ? null : `${what} в этом формате модель не принимает — нужен ${formats}.`;
}

// One image or video reference → the URL the provider fetches. An https URL (already checked by
// refProblem) is passed as is; inline data is stored first and its path recorded.
async function storeRef(v: string, stored: string[]): Promise<string> {
  if (!v.startsWith('data:')) return v;
  const d = splitDataUrl(v);
  const ext = d ? REF_TYPES[d.mime] : undefined;
  if (!d || !ext) throw badRequest('Этот файл нельзя использовать как референс.');
  const bin = atob(d.base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const path = `${REF_DIR}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabaseAdmin.storage.from(VIDEO_BUCKET).upload(path, bytes, { contentType: d.mime, upsert: false });
  if (error) throw error;
  stored.push(path);
  return supabaseAdmin.storage.from(VIDEO_BUCKET).getPublicUrl(path).data.publicUrl;
}

// Audio travels inline (base64 + format); anything else is skipped.
function audioRef(v: string): VideoRefEntry | null {
  const d = splitDataUrl(v);
  const format = d ? AUDIO_FORMATS[d.mime] : undefined;
  return d && format ? { type: 'input_audio', input_audio: { data: d.base64, format } } : null;
}

async function removeRefs(paths: unknown): Promise<void> {
  const list = Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string' && p.startsWith(`${REF_DIR}/`)) : [];
  if (!list.length) return;
  const { error } = await supabaseAdmin.storage.from(VIDEO_BUCKET).remove(list);
  if (error) console.error('reference cleanup failed', error);
}

// The stored references ride on the reservation (result.refs) until the job is over: settling
// replaces result with the video URLs, so they are read before that.
async function rememberRefs(reservation: string, paths: string[]): Promise<void> {
  if (!paths.length) return;
  const { error } = await supabaseAdmin.from('generation_reservations').update({ result: { refs: paths } }).eq('id', reservation);
  if (error) console.error('remember references failed', error);
}
async function takeRefs(reservation: string): Promise<string[]> {
  const { data } = await supabaseAdmin.from('generation_reservations').select('result').eq('id', reservation).maybeSingle();
  const refs = (data?.result as { refs?: unknown } | null)?.refs;
  return Array.isArray(refs) ? refs.filter((p): p is string => typeof p === 'string') : [];
}

// Submits; when the provider refuses the request (400) and it carried audio references, once more
// without them, so an unsupported audio reference costs the audio, not the whole video.
async function submitVideoWithRefs(input: Record<string, unknown>): Promise<{ id: string }> {
  try {
    return await submitOpenRouterVideoJob(input);
  } catch (err) {
    const refs = Array.isArray(input.input_references) ? (input.input_references as VideoRefEntry[]) : [];
    if (!refs.some((r) => r.type === 'input_audio') || !/submit error 400/.test(String(err))) throw err;
    console.error('audio references refused, retrying without them:', String(err).slice(0, 300));
    const rest = refs.filter((r) => r.type !== 'input_audio');
    const { input_references: _drop, ...base } = input;
    return await submitOpenRouterVideoJob(rest.length ? { ...base, input_references: rest } : base);
  }
}
