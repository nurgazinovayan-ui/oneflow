// motion-storyboard: a brief with attached photos and video keyframes reaches Claude Opus 5.5 as
// pictures, and the model's answer comes back as a storyboard the renderer can draw — including the
// usual ways a real answer is off (markdown fences, text around the JSON, cut short at max_tokens).
import { call, done, fake, load, ok, providerCalls, reset, rpcCalls, token } from './harness.ts';

const A = token('user-a');
fake.users['user-a'] = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
// in-memory reservations: the code/fix jobs leave their outcome there and the polls read it
const jobs: Record<string, { id: string; user: string; status: string; result: unknown; model: string; created_at: string }> = {};
let jobSeq = 0;
fake.rpc['reserve_generation_v2'] = (a) => {
  const id = `00000000-0000-4000-8000-${String(++jobSeq).padStart(12, '0')}`;
  jobs[id] = { id, user: String(a.p_user), status: 'pending', result: null, model: String(a.p_model), created_at: new Date().toISOString() };
  return { id, replay: false, status: 'pending' };
};
fake.rpc['settle_generation'] = (a) => {
  const j = jobs[String(a.p_reservation)];
  if (j?.status === 'pending') {
    j.status = 'settled';
    j.result = JSON.stringify(a.p_result ?? null).length <= 65536 ? a.p_result : null;
  }
  return null;
};
fake.rpc['release_generation'] = (a) => {
  const j = jobs[String(a.p_reservation)];
  if (j?.status === 'pending') j.status = 'released';
  return null;
};
fake.tables['generation_reservations'] = (method, url, body) => {
  const id = url.searchParams.get('id')?.replace('eq.', '') ?? '';
  const j = jobs[id];
  if (method === 'PATCH') {
    if (j && url.searchParams.get('status') === 'eq.' + j.status) Object.assign(j, body as object);
    return [];
  }
  const user = url.searchParams.get('user_id')?.replace('eq.', '');
  if (!j || (user && j.user !== user)) return [];
  return [{ id: j.id, status: j.status, provider_job_id: null, amount_usd: 0, result: j.result, model: j.model, created_at: j.created_at }];
};
const settle = () => new Promise((r) => setTimeout(r, 30)); // the background job finishes
// start a job, let it run, poll it once
const viaJob = async (b: unknown) => {
  const first = await call('motion-storyboard', b, { token: A });
  if (first.status !== 202) return { first, poll: first };
  await settle();
  return { first, poll: await call('motion-storyboard', { jobId: first.json.jobId }, { token: A }) };
};

const jpeg = 'data:image/jpeg;base64,' + btoa('x'.repeat(120_000));
const storyboard = {
  title: 'Утро с Aroma One',
  concept: 'Кофемашина как ритуал утра.',
  style: { bg: '#1a120b', ink: '#fff7ec', accent: '#e8a33d', font: 'serif', mood: 'тёплое утро', fx: ['grain', 'vignette'] },
  scenes: [
    { dur: 4, layout: 'full', asset: 0, assets: [], headline: 'Насыщенный вкус', sub: '', cta: '', camera: 'zoom-in', textAnim: 'fade-up', transition: 'fade', bg: '', note: 'Открываем на машине' },
    { dur: 5, layout: 'split-left', asset: 1, assets: [], headline: 'Капучино за минуту', sub: 'Одной кнопкой', cta: '', camera: 'pan-left', textAnim: 'mask-up', transition: 'slide', bg: '', note: 'Видео с пенкой' },
    { dur: 6, layout: 'center-card', asset: 0, assets: [], headline: 'Aroma One', sub: '', cta: 'Купить', camera: 'drift', textAnim: 'scale', transition: 'zoom', bg: '', note: 'Финал' },
  ],
};
let reply = '';
let finish = 'stop';
fake.provider = () => Response.json({ choices: [{ message: { content: reply }, finish_reason: finish }], usage: { cost: 0.21, prompt_tokens: 9000, completion_tokens: 1500 } });

await load('../../../supabase/functions/motion-storyboard/index.ts');
const body = {
  mode: 'storyboard',
  brief: 'Реклама кофемашины Aroma One, 15 секунд',
  duration: 15,
  aspect: '9:16',
  assets: [
    { kind: 'image', name: 'machine.jpg', frames: [jpeg] },
    { kind: 'video', name: 'foam.mov', duration: 6.2, frames: [jpeg, jpeg, jpeg] },
  ],
};
const sent = () => providerCalls()[0]?.body;
const images = () => (sent()?.messages?.[1]?.content ?? []).filter((c: any) => c.type === 'image_url').length;

for (const [label, text] of [
  ['plain JSON', JSON.stringify(storyboard)],
  ['```json fences', '```json\n' + JSON.stringify(storyboard, null, 2) + '\n```'],
  ['text around it', 'Вот раскадровка:\n' + JSON.stringify(storyboard) + '\nНадеюсь, подойдёт!'],
] as const) {
  reset();
  reply = text;
  const r = await call('motion-storyboard', body, { token: A });
  const sb = r.json?.storyboard;
  ok(r.status === 200 && sb?.scenes?.length === 3, `${label}: storyboard back (${r.status} ${JSON.stringify(r.json).slice(0, 120)})`);
  if (label === 'plain JSON') {
    ok(images() === 4, `Opus sees the 4 pictures of the 2 materials (${images()})`);
    ok(sent()?.model === 'anthropic/claude-opus-5.5', `model ${sent()?.model}`);
    ok(Math.abs(sb.scenes.reduce((s: number, x: any) => s + x.dur, 0) - 15) < 0.01, 'scenes add up to the duration');
    ok(rpcCalls('settle_generation')[0]?.body?.p_cost === 0.21, 'charged the real cost');
  }
}

reset();
finish = 'length';
reply = JSON.stringify(storyboard).slice(0, 700);
let r = await call('motion-storyboard', body, { token: A });
ok(r.status === 500 && rpcCalls('release_generation').length === 1 && rpcCalls('settle_generation').length === 0, 'storyboard cut short: an error, nothing charged');
finish = 'stop';

// ---- mode 'code': Opus writes the animation itself
const meta = { title: 'Утро', concept: 'Кофе как ритуал', background: '#120c08', palette: ['#e8a33d', '#fff7ec', 'nope'], beats: [{ start: 0, end: 7, text: 'Машина' }, { start: 7, end: 15, text: 'Пенка' }], clips: [{ asset: 1, start: 4, end: 9, from: 0.5 }, { asset: 0, start: 0, end: 3, from: 0 }] };
const code = 'function frame(ctx, t, env) {\n  cover(ctx, assets[0].image, 0, 0, W, H, { zoom: 1 + t * 0.01 });\n}';
reset();
reply = `<meta>\n${JSON.stringify(meta)}\n</meta>\n<code>\n\`\`\`js\n${code}\n\`\`\`\n</code>`;
let job = await viaJob({ ...body, mode: 'code' });
ok(job.first.status === 202 && job.first.json?.pending === true && typeof job.first.json?.jobId === 'string', `code: answers 202 with a job at once (${job.first.status})`);
r = job.poll;
const comp = r.json?.composition;
ok(r.status === 200 && comp?.code === code, `code: the poll returns the composition, fences stripped (${r.status} ${JSON.stringify(r.json).slice(0, 160)})`);
ok(typeof (jobs[job.first.json.jobId].result as any)?.composition?.codeGz === 'string' && !JSON.stringify(jobs[job.first.json.jobId].result).includes('cover(ctx'), 'code: kept on the reservation gzipped');
ok(sent()?.messages?.[0]?.content?.includes('function frame(ctx, t, env)') && images() === 4, 'code: Opus gets the runtime contract and all 4 pictures');
ok(sent()?.max_tokens >= 64000 && sent()?.reasoning?.effort === 'high', `code: thinks it through, with room for it (max_tokens ${sent()?.max_tokens}, effort ${sent()?.reasoning?.effort})`);
ok(comp?.clips?.length === 1 && comp.clips[0].asset === 1, 'code: a clip for a photo is dropped, the video clip kept');
ok(comp?.palette?.length === 2 && comp?.beats?.length === 2 && comp?.duration === 15, 'code: palette, beats and duration normalized');
ok(rpcCalls('settle_generation')[0]?.body?.p_cost === 0.21 && Number(rpcCalls('reserve_generation_v2')[0]?.body?.p_amount) > 0.35, 'code: reserved for the long answer, charged the real cost');

reset();
finish = 'length';
reply = `<meta>${JSON.stringify(meta)}</meta>\n<code>\nfunction frame(ctx, t) {\n  ctx.fillRect(0, 0`;
r = (await viaJob({ ...body, mode: 'code' })).poll;
ok(r.status === 502 && r.json?.code === 'too_long' && rpcCalls('release_generation').length === 1 && rpcCalls('settle_generation').length === 0, `code cut short: the poll says too_long, released (${JSON.stringify(r.json).slice(0, 140)})`);
finish = 'stop';

reset();
reply = 'Извините, не могу.';
r = (await viaJob({ ...body, mode: 'code' })).poll;
ok(r.status === 502 && r.json?.code === 'bad_answer' && rpcCalls('release_generation').length === 1, 'code: an answer without code → the poll says why, released');

reset();
const realProvider = fake.provider;
fake.provider = () => new Response('upstream down', { status: 500 });
r = (await viaJob({ ...body, mode: 'code' })).poll;
ok(r.status === 502 && r.json?.code === 'provider_error' && rpcCalls('release_generation').length === 1, 'code: provider error → the poll says why, released');
fake.provider = realProvider;

// ---- mode 'fix': the browser found an error, Opus gets its code back
reset();
const fixed = code.replace('0.01', '0.02');
reply = `<meta>${JSON.stringify(meta)}</meta><code>${fixed}</code>`;
r = (await viaJob({ mode: 'fix', brief: body.brief, duration: 15, aspect: '9:16', assets: [{ kind: 'image', name: 'a' }, { kind: 'video', name: 'b', duration: 6 }], composition: { ...meta, code }, error: 'TypeError: x is undefined (строка 2, t = 3.0 с)' })).poll;
const userText = sent()?.messages?.[1]?.content ?? '';
ok(r.status === 200 && r.json?.composition?.code === fixed, 'fix: the corrected code comes back');
ok(typeof userText === 'string' && userText.includes('TypeError: x is undefined') && userText.includes(code) && !JSON.stringify(sent()).includes('image_url'), 'fix: Opus sees the error and its code, no pictures re-sent');
reset();
r = await call('motion-storyboard', { mode: 'fix', composition: {} }, { token: A });
ok(r.status === 400 && rpcCalls('reserve_generation_v2').length === 0, 'fix without code: refused before any spend');

// ---- montage: what Opus learns about a video, and what comes back
reset();
const montageBody = {
  mode: 'code',
  brief: 'Смонтируй ролик из моего видео под музыку',
  duration: 15,
  aspect: '9:16',
  assets: [
    {
      kind: 'video', name: 'interview.mov', duration: 92.4, width: 1080, height: 1920,
      frames: Array.from({ length: 10 }, () => jpeg), frameTimes: [2, 9.5, 18, 27, 40, 51, 63, 77, 85, 90],
      shots: [{ start: 0, dur: 12.5, motion: 0.01 }, { start: 12.5, dur: 30, motion: 0.06 }],
      audio: { has: true, loud: [[0, 12.4], [14, 40.2]] },
    },
    { kind: 'audio', name: 'track.mp3', duration: 151, frames: [jpeg] },
  ],
};
const montageMeta = { ...meta, clips: [{ asset: 0, start: 0, end: 6, from: 14, volume: 1 }, { asset: 0, start: 6, end: 15, from: 120, volume: 0.4 }, { asset: 1, start: 0, end: 5, from: 0 }], music: { asset: 1, from: 30, volume: 0.65 }, warnings: ['Видео 1:32 — взяты два лучших фрагмента.', '', 42] };
reply = `<meta>${JSON.stringify(montageMeta)}</meta><code>${code}</code>`;
job = await viaJob(montageBody);
const userParts = sent()?.messages?.[1]?.content ?? [];
const texts = userParts.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
ok(userParts.filter((c: any) => c.type === 'image_url').length === 8, 'montage: up to 8 keyframes of a video, no picture of the audio');
ok(texts.includes('кадр на 18.0 с') && texts.includes('1:32') && texts.includes('явно слышно') && texts.includes('0.0–12.4 с') && texts.includes('Сцены внутри видео'), 'montage: Opus sees the length, the frame times, the shots and where the sound is');
ok(texts.includes('аудио «track.mp3»') && texts.includes('meta.music'), 'montage: the music material is offered for meta.music');
ok(texts.includes('намного больше ролика') && texts.includes('meta.warnings'), 'montage: told to say what it cut when the footage is much longer');
const mc = job.poll.json?.composition;
ok(mc?.clips?.length === 2 && mc.clips[0].volume === 1 && mc.clips[1].volume === 0.4, 'montage: clips keep their volume, a clip of the audio material is dropped');
ok(mc?.clips?.[1]?.from === 92.2, `montage: a cut past the end of its video starts at its last second (${mc?.clips?.[1]?.from})`);
ok(mc?.music?.asset === 1 && mc.music.from === 30 && mc.music.volume === 0.65, 'montage: the music comes back');
ok(JSON.stringify(mc?.warnings) === JSON.stringify(['Видео 1:32 — взяты два лучших фрагмента.']), 'montage: warnings for the user, empty and non-text ones dropped');

// ---- the OpenRouter balance ran out: a plain message, nothing charged, no key link in the logs
reset();
const logged: string[] = [];
const origError = console.error;
console.error = (...a: unknown[]) => logged.push(a.map(String).join(' '));
fake.provider = () => new Response('{"error":{"message":"This request requires more credits. To increase, visit https://openrouter.ai/workspaces/default/keys/abc123secret"}}', { status: 402 });
r = (await viaJob({ ...body, mode: 'code' })).poll;
console.error = origError;
ok(r.status === 502 && r.json?.code === 'provider_unavailable' && rpcCalls('release_generation').length === 1, `empty OpenRouter balance → «временно недоступна», released (${r.json?.code})`);
ok(logged.some((l) => l.includes('402')) && !logged.some((l) => l.includes('abc123secret')), 'the logs keep the status but not the link to the key');
fake.provider = realProvider;

// ---- polls: only the owner, a job still running, a job whose worker is gone
reset();
let release: () => void = () => {};
fake.provider = () => new Promise<Response>((resolve) => (release = () => resolve(Response.json({ choices: [{ message: { content: `<meta>${JSON.stringify(meta)}</meta><code>${code}</code>` }, finish_reason: 'stop' }], usage: { cost: 0.3 } }))));
const started = await call('motion-storyboard', { ...body, mode: 'code' }, { token: A });
const id = started.json.jobId;
r = await call('motion-storyboard', { jobId: id }, { token: A });
ok(r.status === 202 && r.json?.pending === true, 'poll while Opus still writes → 202 pending');
const B = token('user-b');
fake.users['user-b'] = { id: 'bbbbbbbb-0000-0000-0000-000000000002', email: 'b@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
r = await call('motion-storyboard', { jobId: id }, { token: B });
ok(r.status === 404, "another account cannot read someone else's job");
r = await call('motion-storyboard', { jobId: 'not-a-uuid' }, { token: A });
ok(r.status === 404, 'a malformed job id → 404');
release();
await settle();
r = await call('motion-storyboard', { jobId: id }, { token: A });
ok(r.status === 200 && r.json?.composition?.code === code && r.json?.costUsd === 0.3, 'the same job, finished → the composition and its cost');
fake.provider = realProvider;
reset();
fake.provider = () => new Promise<Response>(() => {}); // never answers: the worker died with it
const lost = await call('motion-storyboard', { ...body, mode: 'code' }, { token: A });
jobs[lost.json.jobId].created_at = new Date(Date.now() - 19 * 60_000).toISOString();
r = await call('motion-storyboard', { jobId: lost.json.jobId }, { token: A });
ok(r.status === 502 && r.json?.code === 'job_lost' && jobs[lost.json.jobId].status === 'released', 'a job pending past its deadline → job_lost, reservation released');
fake.provider = realProvider;

done('motion-storyboard');
