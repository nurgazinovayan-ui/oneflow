// messenger-upload-file / messenger-send-message: membership, sniffed content type, GIF host allowlist, rate limit.
import { call, done, fake, load, ok, reset, rpcCalls, token } from './harness.ts';

const A = token('user-a');
fake.users['user-a'] = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
const CH = '11111111-2222-3333-4444-555555555555';
fake.tables['messenger_members'] = (_m, url) => (url.searchParams.get('channel_id') === `eq.${CH}` ? [{ email: 'a@example.com', channel_id: CH }] : []);
fake.tables['messenger_messages'] = (m, _u, body: any) => (m === 'POST' ? [{ id: 'm1', sender_email: 'a@example.com', body: body?.body ?? '', created_at: 'now', kind: body?.kind, media_url: body?.media_url ?? null, file_size: body?.file_size ?? null }] : []);
let limiter = 0;
fake.rpc['rate_limit_hit'] = () => limiter;

await load('../../../supabase/functions/messenger-upload-file/index.ts');
const upload = async (name: string, type: string, bytes: Uint8Array, channel = CH) => {
  const form = new FormData();
  form.set('channelId', channel);
  form.set('file', new File([bytes], name, { type }));
  const req = new Request('http://fn.local/functions/v1/messenger-upload-file', { method: 'POST', headers: { Authorization: `Bearer ${A}` }, body: form });
  return await call('messenger-upload-file', undefined, { token: A, raw: await req.blob(), headers: { 'Content-Type': req.headers.get('content-type')! } });
};

reset();
let r = await upload('evil.html', 'text/html', new TextEncoder().encode('<script>alert(document.domain)</script>'));
ok(r.status === 200 && fake.storage[0]?.contentType === 'application/octet-stream', 'HTML claimed as text/html is stored as application/octet-stream');
reset();
r = await upload('x.svg', 'image/svg+xml', new TextEncoder().encode('<svg onload=alert(1)>'));
ok(fake.storage[0]?.contentType === 'application/octet-stream', 'SVG is not served as an image/svg+xml page');
reset();
r = await upload('photo.png', 'text/html', new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
ok(fake.storage[0]?.contentType === 'image/png', 'a real PNG is stored as image/png whatever the browser claimed');
ok(typeof r.json.mediaUrl === 'string' && r.json.mediaUrl.includes('token='), 'upload answers a signed (private) URL');
reset();
r = await upload('a.png', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]), '99999999-2222-3333-4444-555555555555');
ok(r.status === 403 && fake.storage.length === 0, 'non-member cannot upload into another chat');
reset();
limiter = 30;
r = await upload('a.png', 'image/png', new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
ok(r.status === 429 && r.headers.get('retry-after') === '30' && fake.storage.length === 0, 'upload rate limit → 429 Retry-After');
limiter = 0;
done('messenger-upload-file');
