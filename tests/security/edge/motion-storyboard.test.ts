// motion-storyboard: a brief with attached photos and video keyframes reaches Claude Opus 5.5 as
// pictures, and the model's answer comes back as a storyboard the renderer can draw — including the
// usual ways a real answer is off (markdown fences, text around the JSON, cut short at max_tokens).
import { call, done, fake, load, ok, providerCalls, reset, rpcCalls, token } from './harness.ts';

const A = token('user-a');
fake.users['user-a'] = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
fake.rpc['reserve_generation_v2'] = () => ({ id: 'res-1', replay: false, status: 'pending' });

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
r = await call('motion-storyboard', { ...body, mode: 'code' }, { token: A });
const comp = r.json?.composition;
ok(r.status === 200 && comp?.code === code, `code: the composition comes back, fences stripped (${r.status} ${JSON.stringify(r.json).slice(0, 160)})`);
ok(sent()?.messages?.[0]?.content?.includes('function frame(ctx, t, env)') && images() === 4, 'code: Opus gets the runtime contract and all 4 pictures');
ok(sent()?.max_tokens >= 12000, `code: room for a whole animation (max_tokens ${sent()?.max_tokens})`);
ok(comp?.clips?.length === 1 && comp.clips[0].asset === 1, 'code: a clip for a photo is dropped, the video clip kept');
ok(comp?.palette?.length === 2 && comp?.beats?.length === 2 && comp?.duration === 15, 'code: palette, beats and duration normalized');
ok(rpcCalls('settle_generation')[0]?.body?.p_cost === 0.21 && Number(rpcCalls('reserve_generation_v2')[0]?.body?.p_amount) > 0.35, 'code: reserved for the long answer, charged the real cost');

reset();
finish = 'length';
reply = `<meta>${JSON.stringify(meta)}</meta>\n<code>\nfunction frame(ctx, t) {\n  ctx.fillRect(0, 0`;
r = await call('motion-storyboard', { ...body, mode: 'code' }, { token: A });
ok(r.status === 200 && r.json?.failed === true && r.json?.code === 'too_long' && rpcCalls('release_generation').length === 1 && rpcCalls('settle_generation').length === 0, `code cut short: failed:too_long, released (${JSON.stringify(r.json).slice(0, 140)})`);
finish = 'stop';

reset();
reply = 'Извините, не могу.';
r = await call('motion-storyboard', { ...body, mode: 'code' }, { token: A });
ok(r.json?.failed === true && r.json?.code === 'bad_answer' && rpcCalls('release_generation').length === 1, 'code: an answer without code → failed, released');

reset();
const realProvider = fake.provider;
fake.provider = () => new Response('upstream down', { status: 500 });
r = await call('motion-storyboard', { ...body, mode: 'code' }, { token: A });
ok(r.json?.failed === true && r.json?.code === 'provider_error' && rpcCalls('release_generation').length === 1, 'code: provider error → failed, released');
fake.provider = realProvider;

// ---- mode 'fix': the browser found an error, Opus gets its code back
reset();
const fixed = code.replace('0.01', '0.02');
reply = `<meta>${JSON.stringify(meta)}</meta><code>${fixed}</code>`;
r = await call('motion-storyboard', { mode: 'fix', brief: body.brief, duration: 15, aspect: '9:16', assets: [{ kind: 'image', name: 'a' }, { kind: 'video', name: 'b', duration: 6 }], composition: { ...meta, code }, error: 'TypeError: x is undefined (строка 2, t = 3.0 с)' }, { token: A });
const userText = sent()?.messages?.[1]?.content ?? '';
ok(r.status === 200 && r.json?.composition?.code === fixed, 'fix: the corrected code comes back');
ok(typeof userText === 'string' && userText.includes('TypeError: x is undefined') && userText.includes(code) && !JSON.stringify(sent()).includes('image_url'), 'fix: Opus sees the error and its code, no pictures re-sent');
reset();
r = await call('motion-storyboard', { mode: 'fix', composition: {} }, { token: A });
ok(r.status === 400 && rpcCalls('reserve_generation_v2').length === 0, 'fix without code: refused before any spend');

done('motion-storyboard');
