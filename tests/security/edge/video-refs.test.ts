// Video references (generate-video and generate-video-pro): frames go in frame_images, guiding media
// in input_references (on a model without them the first photo becomes the first frame); inline
// images and videos are stored under refs/ and passed by URL, then removed when the job is over;
// audio goes inline and is dropped if the provider refuses it; a file the model cannot take is
// refused with the reason before any money is reserved; a refusal for money carries the numbers.
//   FN=generate-video | generate-video-pro   deno run -A tests/security/edge/video-refs.test.ts
import { call, done, fake, load, ok, providerCalls, reset, rpcCalls, token } from './harness.ts';

const FN = Deno.env.get('FN') ?? 'generate-video';
const PRO = FN === 'generate-video-pro';
const A = token('user-a');
fake.users['user-a'] = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
const JOB = 'cccccccc-1111-2222-3333-444444444444';

type Job = { id: string; user: string; status: string; provider_job_id: string | null; amount_usd: number; result: unknown; model: string };
const jobs: Record<string, Job> = {};
let quota: unknown = null; // when set, the gate refuses with this error
fake.rpc['reserve_generation_v2'] = (a) => {
  if (quota) return { error: quota };
  jobs[JOB] = { id: JOB, user: String(a.p_user), status: 'pending', provider_job_id: null, amount_usd: Number(a.p_amount), result: null, model: String(a.p_model) };
  return { id: JOB, replay: false, status: 'pending' };
};
fake.rpc['credit_balance'] = () => [{ available: 80, reserved: 30, active_total: 100, next_expiry_at: null, next_expiry_credits: null, unlimited: false }];
fake.rpc['mark_generation_submitted'] = (a) => {
  const j = jobs[String(a.p_reservation)];
  if (j?.status !== 'pending') return false;
  j.status = 'submitted';
  j.provider_job_id = String(a.p_provider_job);
  return true;
};
fake.rpc['claim_generation_completion'] = (a) => {
  const j = jobs[String(a.p_reservation)];
  if (!j || j.user !== a.p_user || j.status !== 'submitted') return false;
  j.status = 'finishing';
  return true;
};
fake.rpc['settle_generation'] = (a) => {
  const j = jobs[String(a.p_reservation)];
  if (j && ['pending', 'submitted', 'finishing'].includes(j.status)) {
    j.status = 'settled';
    j.result = a.p_result;
  }
  return null;
};
fake.rpc['release_generation'] = (a) => {
  const j = jobs[String(a.p_reservation)];
  if (j && ['pending', 'submitted', 'finishing'].includes(j.status)) j.status = 'released';
  return null;
};
fake.tables['generation_reservations'] = (method, url, body) => {
  const id = url.searchParams.get('id')?.replace('eq.', '');
  const user = url.searchParams.get('user_id')?.replace('eq.', '');
  const j = id ? jobs[id] : undefined;
  if (!j || (user && j.user !== user)) return [];
  if (method === 'PATCH') {
    Object.assign(j, body as Record<string, unknown>);
    return [];
  }
  return [{ id: j.id, status: j.status, provider_job_id: j.provider_job_id, amount_usd: j.amount_usd, result: j.result, model: j.model }];
};

const assetRows: unknown[] = [];
fake.tables['user_assets'] = (method, _url, body) => {
  if (method === 'POST') assetRows.push(body);
  return [];
};

let providerState = 'in_progress';
let refuseAudio = false;
fake.provider = (url, init) => {
  if (url.endsWith('/videos') && init.method === 'POST') {
    const sent = JSON.parse(String(init.body));
    if (refuseAudio && JSON.stringify(sent).includes('input_audio')) return new Response('{"error":{"message":"input_references[2]: unsupported"}}', { status: 400 });
    return Response.json({ id: 'prov-job-1' });
  }
  if (url.includes('/content')) return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
  return Response.json({ id: 'prov-job-1', status: providerState, usage: { cost: 0.5 } });
};
await load(`../../../supabase/functions/${FN}/index.ts`, { VIDEO_SYNC_WAIT_MS: '50', VIDEO_RESUME_WAIT_MS: '50', VIDEO_POLL_INTERVAL_MS: '10' });

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
const MP4 = 'data:video/mp4;base64,AAAAGGZ0eXBtcDQy';
const MP3 = 'data:audio/mpeg;base64,SUQzBAAAAAAAI1RTU0U=';
const uploads = () => fake.storage.filter((s) => s.path.includes('/ai-generated-videos/refs/'));
const removals = () => fake.calls.filter((c) => c.kind === 'storage' && c.name.startsWith('DELETE'));
const submitted = () => providerCalls().filter((c) => c.name.endsWith('/videos')).map((c) => c.body);

if (!PRO) {
  const base = { model: 'kwaivgi/kling-v3-video', prompt: 'a dog', resolution: '720p', duration: 5, aspectRatio: '9:16' };

  // 1. first + last frame → frame_images by stored URL, no references, no aspect ratio
  reset();
  providerState = 'in_progress';
  let r = await call(FN, { ...base, image: PNG, lastImage: JPG }, { token: A });
  let sent = submitted()[0] ?? {};
  ok(r.status === 202, 'frames: job submitted');
  ok(uploads().length === 2 && uploads()[0].contentType === 'image/png' && uploads()[1].contentType === 'image/jpeg', 'frames: both photos stored under refs/ with their type');
  ok(sent.frame_images?.length === 2 && sent.frame_images[0].frame_type === 'first_frame' && sent.frame_images[1].frame_type === 'last_frame', 'frames: first_frame and last_frame sent');
  ok(sent.frame_images?.every((f: any) => f.type === 'image_url' && f.image_url.url.includes('/object/public/ai-generated-videos/refs/')), 'frames: passed by public URL, not inline');
  ok(!sent.input_references && !sent.aspect_ratio && !JSON.stringify(sent).includes('base64'), 'frames: no references, no aspect ratio, no inline data');
  ok(Array.isArray((jobs[JOB].result as any)?.refs) && (jobs[JOB].result as any).refs.length === 2, 'frames: stored paths remembered on the reservation');

  // 2. the job finishes → settled, then the reference files are removed
  reset();
  providerState = 'completed';
  r = await call(FN, { jobId: JOB }, { token: A });
  ok(r.status === 200 && jobs[JOB].status === 'settled', 'frames: owner gets the video');
  const asset = assetRows[0] && (Array.isArray(assetRows[0]) ? assetRows[0][0] : assetRows[0]);
  ok(asset?.user_id === 'aaaaaaaa-0000-0000-0000-000000000001' && asset.kind === 'video' && asset.bucket === 'ai-generated-videos' && /\.mp4$/.test(asset.path), 'video kept for its owner (user_assets row)');
  ok(asset?.prompt === 'a dog' && asset.model === 'kwaivgi/kling-v3-video' && asset.meta?.aspectRatio === '9:16' && asset.meta?.duration === 5, 'the row carries what was asked at submit (prompt, model, format)');
  ok(removals().length === 1 && JSON.stringify(removals()[0].body).includes('refs/'), 'frames: reference files removed after the job');

  // 3. reference photos on a model that takes them (Seedance 2.0) → input_references, aspect ratio kept
  reset();
  providerState = 'in_progress';
  r = await call(FN, { ...base, model: 'bytedance/seedance-2.0', references: [PNG, JPG] }, { token: A });
  sent = submitted()[0] ?? {};
  ok(sent.input_references?.length === 2 && sent.input_references.every((x: any) => x.type === 'image_url' && !x.frame_type), 'references: two image_url references on Seedance');
  ok(!sent.frame_images && sent.aspect_ratio === '9:16', 'references: no frames, aspect ratio sent');

  // 3b. the same photos on Kling, which drops references → the first photo becomes the first frame
  reset();
  r = await call(FN, { ...base, references: [PNG, JPG] }, { token: A });
  sent = submitted()[0] ?? {};
  ok(r.status === 202 && !sent.input_references, 'kling: no input_references (it would drop them)');
  ok(sent.frame_images?.length === 1 && sent.frame_images[0].frame_type === 'first_frame' && uploads().length === 1, 'kling: first reference photo sent as the first frame');

  // 3c. a photo the model cannot take is refused with the reason, before any money is reserved
  const refused = async (body: Record<string, unknown>, words: string, label: string) => {
    reset();
    const res = await call(FN, body, { token: A });
    ok(res.status === 400 && String(res.json.error).includes(words) && rpcCalls('reserve_generation_v2').length === 0 && providerCalls().length === 0, label);
  };
  await refused({ ...base, references: ['data:image/heic;base64,AAAA'] }, 'JPG, PNG или WebP', 'HEIC photo refused with the formats, no reservation');
  await refused({ ...base, image: 'data:image/png;base64,' + 'A'.repeat(12_000_001) }, 'больше 9 МБ', 'photo over 9 MB refused, no reservation');
  await refused({ ...base, references: [PNG, PNG, PNG, PNG, PNG] }, 'Не больше 4', 'a fifth reference photo refused, not dropped');
  await refused({ ...base, references: ['data:text/plain;base64,aGk='] }, 'в этом формате', 'a non-image reference refused');

  // 4. the provider refuses → reservation released and the stored files removed
  reset();
  const saved = fake.provider;
  fake.provider = () => new Response('bad request', { status: 400 });
  r = await call(FN, { ...base, image: PNG }, { token: A });
  ok(r.status === 500 && jobs[JOB].status === 'released' && removals().length === 1, 'refused submit → released, reference removed');
  fake.provider = saved;
} else {
  const base = { prompt: 'a dog @Image1', resolution: '720p', duration: 5, aspectRatio: '16:9' };

  // 1. image, video and audio references → one input_references array; old fields gone
  reset();
  providerState = 'in_progress';
  let r = await call(FN, { ...base, images: [PNG], videos: [MP4], audios: [MP3] }, { token: A });
  let sent = submitted()[0] ?? {};
  const refs = sent.input_references ?? [];
  ok(r.status === 202, 'pro: job submitted');
  ok(refs.length === 3 && refs[0].type === 'image_url' && refs[1].type === 'video_url' && refs[2].type === 'input_audio', 'pro: image, video and audio in input_references');
  ok(refs[0].image_url?.url.includes('/refs/') && refs[1].video_url?.url.includes('/refs/') && refs[2].input_audio?.format === 'mp3', 'pro: image/video by stored URL, audio inline as mp3');
  ok(!('images' in sent) && !('videos' in sent) && !('audios' in sent), 'pro: no images/videos/audios fields');
  ok(uploads().length === 2 && uploads()[1].contentType === 'video/mp4', 'pro: photo and video stored under refs/');
  ok(rpcCalls('reserve_generation_v2').length === 1, 'pro: one reservation');

  // 2. a provider that refuses audio still makes the video, without the audio
  reset();
  refuseAudio = true;
  r = await call(FN, { ...base, images: [PNG], audios: [MP3] }, { token: A });
  const both = submitted();
  ok(r.status === 202 && both.length === 2, 'pro: refused audio → sent again');
  ok(JSON.stringify(both[1]).includes('image_url') && !JSON.stringify(both[1]).includes('input_audio'), 'pro: second try keeps the photo, drops the audio');
  refuseAudio = false;

  // 3. a reference the model cannot take is refused with the reason, before any money is reserved
  for (const [body, words, label] of [
    [{ ...base, videos: [PNG] }, 'Видео в этом формате', 'pro: a "video" that is really a photo refused'],
    [{ ...base, images: Array(10).fill(PNG) }, 'Не больше 9 фото', 'pro: a tenth photo refused, not dropped'],
    [{ ...base, audios: ['https://example.com/a.mp3'] }, 'Аудио недоступно по ссылке', 'pro: audio by link refused (it travels inline)'],
  ] as const) {
    reset();
    r = await call(FN, body, { token: A });
    ok(r.status === 400 && String(r.json.error).includes(words) && rpcCalls('reserve_generation_v2').length === 0, label);
  }
}

// refusal for money: the price, what is free and what is held, in credits
reset();
quota = 'quota_exceeded';
const r = await call(FN, PRO ? { prompt: 'x', resolution: '720p', duration: 5 } : { model: 'kwaivgi/kling-v3-video', prompt: 'x', resolution: '720p', duration: 5 }, { token: A });
ok(r.status === 402 && r.json.code === 'quota_exceeded', 'quota: 402 quota_exceeded');
ok(r.json.needed === (PRO ? 120 : 63) && r.json.available === 50 && r.json.reserved === 30, 'quota: needed / available / reserved in credits');
ok(providerCalls().length === 0 && uploads().length === 0, 'quota: nothing stored, provider not called');
quota = null;

done(`${FN} references`);
