// lemonsqueezy-webhook: signature on the raw body, size cap, one application per event, no parsing of unsigned data.
import { call, done, fake, load, ok, reset, rpcCalls } from './harness.ts';

const SECRET = 'whsec-test-only';
const applied = new Set<string>();
fake.rpc['subscription_apply_event'] = (a) => {
  const id = String(a.p_event_id);
  if (applied.has(id)) return 'duplicate';
  applied.add(id);
  return 'applied';
};
await load('../../../supabase/functions/lemonsqueezy-webhook/index.ts', { LEMONSQUEEZY_WEBHOOK_SECRET: SECRET });
const sign = async (raw: string) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
};
const event = {
  meta: { event_name: 'subscription_updated', custom_data: { user_id: 'aaaaaaaa-0000-0000-0000-000000000001' } },
  data: { id: '123', attributes: { status: 'active', customer_id: 9, renews_at: '2026-11-09T00:00:00Z', updated_at: '2026-10-09T10:00:00Z' } },
};
const raw = JSON.stringify(event);

reset();
let r = await call('lemonsqueezy-webhook', undefined, { raw, headers: { 'X-Signature': 'deadbeef' } });
ok(r.status === 401 && rpcCalls('subscription_apply_event').length === 0, 'bad signature → 401, nothing applied');
reset();
r = await call('lemonsqueezy-webhook', undefined, { raw });
ok(r.status === 401 && rpcCalls('subscription_apply_event').length === 0, 'missing signature → 401');
reset();
r = await call('lemonsqueezy-webhook', undefined, { raw: raw.replace('active', 'on_trial'), headers: { 'X-Signature': await sign(raw) } });
ok(r.status === 401, 'signature of another body does not verify a tampered body');

reset();
r = await call('lemonsqueezy-webhook', undefined, { raw, headers: { 'X-Signature': await sign(raw) } });
const c = rpcCalls('subscription_apply_event')[0]?.body;
ok(r.status === 200 && c?.p_status === 'active' && c?.p_user === 'aaaaaaaa-0000-0000-0000-000000000001', 'valid event applied');
ok(/^[0-9a-f]{64}$/.test(c?.p_event_id) && c?.p_provider_updated_at === '2026-10-09T10:00:00Z', 'event id = sha256(body), provider time passed for ordering');
reset();
r = await call('lemonsqueezy-webhook', undefined, { raw, headers: { 'X-Signature': (await sign(raw)).toUpperCase() } });
ok(r.status === 200 && rpcCalls('subscription_apply_event').length === 1, 'redelivery reaches the database, which answers duplicate (no second change)');
ok(applied.size === 1, 'the same event is applied once');

reset();
const bogus = JSON.stringify({ ...event, meta: { ...event.meta, custom_data: { user_id: "x' or 1=1 --" } } });
r = await call('lemonsqueezy-webhook', undefined, { raw: bogus, headers: { 'X-Signature': await sign(bogus) } });
ok(r.status === 200 && rpcCalls('subscription_apply_event').length === 0, 'non-uuid user hint ignored (no state change)');

reset();
r = await call('lemonsqueezy-webhook', undefined, { raw: 'x', headers: { 'Content-Length': String(5 * 1024 * 1024) } });
ok(r.status === 413, 'oversized body refused before reading');

reset();
const order = JSON.stringify({ meta: { event_name: 'order_created' }, data: { attributes: { total: 100000 } } });
r = await call('lemonsqueezy-webhook', undefined, { raw: order, headers: { 'X-Signature': await sign(order) } });
ok(r.status === 200 && fake.calls.filter((x) => x.kind === 'rpc').length === 0, 'order events never grant anything from here');
done('lemonsqueezy-webhook');
