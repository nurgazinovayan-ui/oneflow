// generate-image: auth, server-side pricing, the gate's refusals, idempotency, internal URLs.
import { call, done, fake, load, ok, providerCalls, reset, rpcCalls, token } from './harness.ts';

const A = token('user-a');
fake.users['user-a'] = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
let gate: Record<string, unknown> = { id: 'res-1', replay: false, status: 'pending' };
fake.rpc['reserve_generation_v2'] = () => gate;
fake.provider = () => Response.json({ data: [{ b64_json: 'AAAA', media_type: 'image/png' }], usage: { cost: 0.0336 } });
await load('../../../supabase/functions/generate-image/index.ts');
const fn = 'generate-image';
const okBody = { model: 'google/nano-banana-2.1', prompt: 'a cat', resolution: '1K', aspectRatio: '1:1' };

// 1. no session → nothing reserved, nothing paid
reset();
let r = await call(fn, okBody);
ok(r.status === 401 && providerCalls().length === 0 && rpcCalls('reserve_generation_v2').length === 0, 'unauthenticated request does not reach the provider');
reset();
r = await call(fn, okBody, { token: token('forged') });
ok(r.status === 401 && providerCalls().length === 0, 'unknown/forged token is refused');

// 2. the price is the server's: client-sent price, cost, balance, user id are ignored
reset();
r = await call(fn, { ...okBody, costUsd: 0, price: 0, balance: 99999, userId: 'someone-else', p_amount: 0 }, { token: A });
const res1 = rpcCalls('reserve_generation_v2')[0]?.body;
ok(r.status === 200, 'valid request succeeds');
ok(res1?.p_amount === 0.0336 && res1?.p_user === 'aaaaaaaa-0000-0000-0000-000000000001', 'reserve uses the server price and the session user, not body fields');
ok(rpcCalls('settle_generation')[0]?.body?.p_cost === 0.0336, 'settled with the provider-reported cost');

// 3. resolution must be a priced tier of that model (the 4K-at-1K-price bug)
reset();
r = await call(fn, { ...okBody, resolution: '8K' }, { token: A });
ok(r.status === 400 && rpcCalls('reserve_generation_v2').length === 0 && providerCalls().length === 0, 'unpriced resolution refused before any spend');
reset();
r = await call(fn, { ...okBody, model: 'openai/gpt-image-2', resolution: '4K' }, { token: A });
ok(r.status === 400 && providerCalls().length === 0, 'gpt-image-2 cannot be asked for 4K outside its price table');
reset();
r = await call(fn, { ...okBody, resolution: '4K' }, { token: A });
ok(rpcCalls('reserve_generation_v2')[0]?.body?.p_amount === 0.0756, '4K is reserved at the 4K price');
reset();
r = await call(fn, { ...okBody, model: 'krea/krea-2-large', resolution: '4K' }, { token: A });
ok(r.status === 200 && providerCalls()[0]?.body?.resolution === undefined, 'flat-priced model never gets a resolution');
reset();
r = await call(fn, { ...okBody, model: 'evil/expensive-model' }, { token: A });
ok(r.status === 400 && providerCalls().length === 0, 'model outside the allowlist refused');

// 4. internal or credentialed reference URLs never reach the provider
reset();
r = await call(fn, {
  ...okBody,
  images: ['https://169.254.169.254/latest/meta-data', 'https://localhost/x.png', 'https://user:pw@example.com/a.png', 'http://example.com/a.png', 'https://10.0.0.5/a.png', 'https://metadata.google.internal/x', 'https://cdn.example.com/ok.png'],
}, { token: A });
const refs = providerCalls()[0]?.body?.input_references ?? [];
ok(refs.length === 1 && refs[0].image_url.url === 'https://cdn.example.com/ok.png', 'only the public https reference is forwarded');

// 5. the gate refuses → no provider call, stable code, Retry-After where it applies
for (const [code, status] of [['service_paused', 503], ['account_blocked', 403], ['spend_limit', 429], ['quota_exceeded', 402], ['too_many_jobs', 429], ['email_not_confirmed', 403]] as const) {
  reset();
  gate = { error: code };
  r = await call(fn, okBody, { token: A });
  ok(r.status === status && r.json.code === code && providerCalls().length === 0, `${code} → ${status}, provider not called`);
}
reset();
gate = { error: 'rate_limited', retry_after: 60 };
r = await call(fn, okBody, { token: A });
ok(r.status === 429 && r.headers.get('retry-after') === '60' && providerCalls().length === 0, 'rate_limited → 429 with Retry-After');

// 6. the gate is down → fail closed
reset();
fake.rpc['reserve_generation_v2'] = () => new Response(JSON.stringify({ message: 'db down' }), { status: 500 });
r = await call(fn, okBody, { token: A });
ok(r.status === 503 && providerCalls().length === 0, 'database/gate outage → 503, nothing paid');
fake.rpc['reserve_generation_v2'] = () => gate;

// 7. idempotency: the key travels to the gate, a replay is answered without a provider call
reset();
gate = { id: 'res-1', replay: false, status: 'pending' };
r = await call(fn, okBody, { token: A, headers: { 'Idempotency-Key': 'abcdef0123456789' } });
ok(rpcCalls('reserve_generation_v2')[0]?.body?.p_idempotency_key === 'abcdef0123456789', 'Idempotency-Key passed to the gate');
reset();
gate = { id: 'res-1', replay: true, status: 'settled' };
r = await call(fn, okBody, { token: A, headers: { 'Idempotency-Key': 'abcdef0123456789' } });
ok(r.status === 409 && r.json.code === 'duplicate_request' && providerCalls().length === 0, 'replayed request → 409, no second paid call');
reset();
r = await call(fn, okBody, { token: A, headers: { 'Idempotency-Key': 'bad key with spaces' } });
ok(r.status === 400 && providerCalls().length === 0, 'malformed Idempotency-Key refused');

// 8. provider failure → reservation released, no internal details leak
reset();
gate = { id: 'res-2', replay: false, status: 'pending' };
fake.provider = () => new Response('upstream secret detail sk-or-v1-XXXXXXXX', { status: 503 });
r = await call(fn, okBody, { token: A });
ok(r.status === 500 && rpcCalls('release_generation')[0]?.body?.p_reservation === 'res-2' && rpcCalls('settle_generation').length === 0, 'provider failure releases the reservation, no charge');
ok(!JSON.stringify(r.json).includes('sk-or') && !JSON.stringify(r.json).includes('upstream'), 'error response hides provider details');

// 9. oversized body refused before parsing
reset();
r = await call(fn, undefined, { token: A, raw: '{"x":"' + 'a'.repeat(100) + '"}', headers: { 'Content-Length': String(60 * 1024 * 1024) } });
ok(r.status === 413 && rpcCalls('reserve_generation_v2').length === 0, 'declared oversized body → 413');

done('generate-image');
