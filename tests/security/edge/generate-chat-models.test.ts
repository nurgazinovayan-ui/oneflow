// generate-chat: Copywrite's model choice. Only listed models reach OpenRouter; the reservation is
// priced from OpenRouter's catalogue for the chosen model (Anthropic's list price when the
// catalogue is down, refused for a model without one); every other caller keeps the default model.
import { call, done, fake, load, ok, providerCalls, reset, rpcCalls, token } from './harness.ts';

const A = token('user-a');
fake.users['user-a'] = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
fake.rpc['reserve_generation_v2'] = () => ({ id: 'res-1', replay: false, status: 'pending' });

let catalogueUp = false;
let chatError: [number, string] | null = null;
fake.provider = (url) => {
  if (url.endsWith('/api/v1/models')) {
    if (!catalogueUp) return new Response('down', { status: 503 });
    return Response.json({
      data: [
        { id: 'anthropic/claude-opus-5.5', pricing: { prompt: '0.000004', completion: '0.00002' } },
        { id: 'openai/gpt-6.1-sol', pricing: { prompt: '0.000002', completion: '0.00001' } },
        { id: 'openai/gpt-6.1-sol-pro', pricing: { prompt: '0.00002', completion: '0.00016' } },
      ],
    });
  }
  if (chatError) return new Response(chatError[1], { status: chatError[0] });
  return Response.json({ choices: [{ message: { content: 'Готово' } }], usage: { cost: 0.0123 } });
};
const fn = 'generate-chat';
const path = '../../../supabase/functions/generate-chat/index.ts';
const messages = [{ role: 'user', content: 'Напиши слоган для кофейни' }];
const chatCalls = () => providerCalls().filter((c) => c.name.includes('/chat/completions'));
const catalogueCalls = () => providerCalls().filter((c) => c.name.endsWith('/api/v1/models'));
const reserved = () => Number(rpcCalls('reserve_generation_v2')[0]?.body?.p_amount);

// 1. catalogue down (a fresh instance): Claude is reserved at Anthropic's list price, a model
//    without a published fallback is refused before anything is reserved
await load(path + '?catalogue-down');
reset();
let r = await call(fn, { messages, mode: 'text', model: 'anthropic/claude-opus-5.5' }, { token: A });
ok(r.status === 200 && chatCalls()[0]?.body?.model === 'anthropic/claude-opus-5.5', 'catalogue down: Claude still answers');
ok(reserved() >= 8000 * 20e-6 && reserved() < 0.5, `catalogue down: reserved at the list price (${reserved()})`);
reset();
r = await call(fn, { messages, mode: 'text', model: 'openai/gpt-6.1-sol' }, { token: A });
ok(r.status === 503 && r.json.code === 'model_unavailable' && rpcCalls('reserve_generation_v2').length === 0 && chatCalls().length === 0, 'catalogue down: a model with no known price is refused, nothing reserved');

// 2. catalogue up (another fresh instance)
catalogueUp = true;
await load(path + '?catalogue-up');
reset();
r = await call(fn, { messages, mode: 'text' }, { token: A });
ok(r.status === 200 && chatCalls()[0]?.body?.model === 'openai/gpt-5.6-terra' && reserved() === 0.1, 'no model (One Launch): the default model at the old reservation');
reset();
r = await call(fn, { messages, mode: 'assistant', model: 'anthropic/claude-opus-5.5' }, { token: A });
ok(r.status === 200 && chatCalls()[0]?.body?.model === 'openai/gpt-5.6-terra', 'node assistant: a model in the body is ignored');
reset();
r = await call(fn, { messages, mode: 'text', model: 'anthropic/claude-opus-5.5' }, { token: A });
ok(r.status === 200 && r.json === 'Готово' && chatCalls()[0]?.body?.model === 'anthropic/claude-opus-5.5', 'Copywrite: the chosen Claude model answers');
ok(reserved() >= 8000 * 20e-6 && reserved() < 0.5, `Copywrite: reserved from the catalogue price (${reserved()})`);
ok(rpcCalls('reserve_generation_v2')[0]?.body?.p_model === 'anthropic/claude-opus-5.5', 'the reservation names the model (admin logs)');
ok(rpcCalls('settle_generation')[0]?.body?.p_cost === 0.0123, 'settled with the cost OpenRouter reported');
reset();
r = await call(fn, { messages, mode: 'text', model: 'openai/gpt-6.1-sol-pro' }, { token: A });
ok(r.status === 200 && reserved() >= 8000 * 0.00016, `an expensive model reserves more (${reserved()})`);
reset();
await call(fn, { messages, mode: 'text', model: 'openai/gpt-6.1-sol' }, { token: A });
ok(catalogueCalls().length === 0, 'the catalogue is read once, not per request');

// 3. only listed models
for (const bad of ['openai/gpt-4o', 'anthropic/claude-3-opus', '__proto__', 'toString', '', 42]) {
  reset();
  r = await call(fn, { messages, mode: 'text', model: bad }, { token: A });
  ok(r.status === 400 && rpcCalls('reserve_generation_v2').length === 0 && chatCalls().length === 0, `unlisted model ${JSON.stringify(bad)} refused before any spend`);
}

// 4. a model OpenRouter no longer serves: a clear error, the reservation released, nothing charged
chatError = [404, '{"error":{"message":"No endpoints found for model openai/gpt-6.1-sol"}}'];
reset();
r = await call(fn, { messages, mode: 'text', model: 'openai/gpt-6.1-sol' }, { token: A });
ok(r.status === 502 && r.json.code === 'model_unavailable', 'withdrawn model → model_unavailable');
ok(rpcCalls('release_generation').length === 1 && rpcCalls('settle_generation').length === 0, 'its reservation is released, nothing settled');
chatError = [500, 'upstream exploded'];
reset();
r = await call(fn, { messages, mode: 'text', model: 'openai/gpt-6.1-sol' }, { token: A });
ok(r.status === 500 && rpcCalls('release_generation').length === 1, 'other provider errors keep the generic answer and release');

// 5. the app offers exactly the models the server accepts (src/chatModels.ts ↔ COPYWRITE_MODELS)
const listedIds = (rel: string, start: string, end: string) => {
  const src = Deno.readTextFileSync(new URL(rel, import.meta.url));
  const from = src.indexOf(start);
  return [...src.slice(from, src.indexOf(end, from)).matchAll(/'((?:openai|anthropic)\/[\w.-]+)'/g)].map((m) => m[1]).sort();
};
const serverIds = listedIds(path, 'const COPYWRITE_MODELS', '};');
const appIds = listedIds('../../../src/chatModels.ts', 'export const COPYWRITE_MODELS', '];');
ok(serverIds.length === 8 && JSON.stringify(appIds) === JSON.stringify(serverIds), `app and server list the same models (${appIds.join(', ')})`);

done('generate-chat models');
