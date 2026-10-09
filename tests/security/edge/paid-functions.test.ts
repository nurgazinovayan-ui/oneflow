// Every paid function goes through the same gate: run once per function, FN=<name>.
//   FN=generate-chat deno run -A tests/security/edge/paid-functions.test.ts
import { call, done, fake, load, ok, providerCalls, reset, rpcCalls, token } from './harness.ts';

const FN = Deno.env.get('FN') ?? '';
const BODIES: Record<string, unknown> = {
  'generate-chat': { messages: [{ role: 'user', content: 'hi' }] },
  'generate-audio': { mode: 'music', prompt: 'calm piano' },
  'generate-vector': { prompt: 'a logo' },
  'generate-video-pro': { prompt: 'a dog', resolution: '720p', duration: 5 },
  'evaluate-creative': { images: ['https://cdn.example.com/a.png'], platform: 'instagram' },
  'marketing-ai': { task: 'understandBusiness', context: { business: 'coffee shop' } },
  'motion-storyboard': { mode: 'storyboard', brief: 'a short ad', duration: 15 },
};
const A = token('user-a');
fake.users['user-a'] = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
let gate: unknown = { error: 'service_paused' };
fake.rpc['reserve_generation_v2'] = () => gate;
await load(`../../../supabase/functions/${FN}/index.ts`, { REPLICATE_API_KEY: 'test', OPENAI_API_KEY: 'test' });
const body = BODIES[FN];

reset();
let r = await call(FN, body);
ok(r.status === 401 && providerCalls().length === 0 && rpcCalls('reserve_generation_v2').length === 0, `${FN}: no session → 401, nothing reserved or paid`);
reset();
r = await call(FN, body, { token: A, headers: { 'Idempotency-Key': 'key-0123456789' } });
const reserve = rpcCalls('reserve_generation_v2')[0]?.body;
{
  ok(r.status === 503 && r.json.code === 'service_paused' && providerCalls().length === 0, `${FN}: kill switch → 503, provider not called`);
  ok(reserve?.p_idempotency_key === 'key-0123456789' && reserve?.p_function === FN && reserve?.p_user === 'aaaaaaaa-0000-0000-0000-000000000001', `${FN}: key, function and session user reach the gate`);
  ok(Number(reserve?.p_amount) > 0, `${FN}: a positive server-side estimate is reserved`);
}
reset();
fake.rpc['reserve_generation_v2'] = () => new Response('{"message":"down"}', { status: 500 });
r = await call(FN, body, { token: A });
ok((r.status === 503 || r.status === 400) && providerCalls().length === 0, `${FN}: gate outage → refused, provider not called`);
done(FN);
