// user-assets: the caller sees and deletes only their own generations; images by signed link,
// videos by public link; pages by created_at.
import { call, done, fake, load, ok, reset, token } from './harness.ts';

const A = token('user-a');
const B = token('user-b');
const UA = 'aaaaaaaa-0000-0000-0000-000000000001';
const UB = 'bbbbbbbb-0000-0000-0000-000000000002';
fake.users['user-a'] = { id: UA, email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
fake.users['user-b'] = { id: UB, email: 'b@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };

const ID1 = '11111111-1111-4111-8111-111111111111';
const ID2 = '22222222-2222-4222-8222-222222222222';
const ID3 = '33333333-3333-4333-8333-333333333333';
let rows = [
  { id: ID1, user_id: UA, kind: 'image', bucket: 'user-generations', path: `${UA}/a.png`, model: 'google/nano-banana-pro', prompt: 'cup', meta: { aspectRatio: '1:1' }, created_at: '2026-10-28T10:00:03Z' },
  { id: ID2, user_id: UA, kind: 'video', bucket: 'ai-generated-videos', path: 'v.mp4', model: 'kwaivgi/kling-v3-video', prompt: 'cup moves', meta: {}, created_at: '2026-10-28T10:00:02Z' },
  { id: ID3, user_id: UB, kind: 'image', bucket: 'user-generations', path: `${UB}/b.png`, model: 'm', prompt: 'secret', meta: {}, created_at: '2026-10-28T10:00:01Z' },
];
const eq = (url: URL, k: string) => url.searchParams.get(k)?.replace(/^eq\./, '');
fake.tables['user_assets'] = (method, url) => {
  // the fake answers only what the filters ask for, like PostgREST would
  let out = rows.filter((r) => (!eq(url, 'user_id') || r.user_id === eq(url, 'user_id')) && (!eq(url, 'id') || r.id === eq(url, 'id')) && (!eq(url, 'kind') || r.kind === eq(url, 'kind')));
  const lt = url.searchParams.get('created_at')?.replace(/^lt\./, '');
  if (lt) out = out.filter((r) => r.created_at < lt);
  if (method === 'DELETE') {
    rows = rows.filter((r) => !out.includes(r));
    return [];
  }
  const limit = Number(url.searchParams.get('limit') ?? '1000');
  return out.sort((x, y) => (x.created_at < y.created_at ? 1 : -1)).slice(0, limit);
};
await load('../../../supabase/functions/user-assets/index.ts');
const fn = 'user-assets';
const tableCalls = () => fake.calls.filter((c) => c.kind === 'table');
const urlOf = (c: { url?: unknown } | undefined) => (c?.url ? new URL(String(c.url)) : undefined);

// 1. no session → nothing read
reset();
let r = await call(fn, { action: 'list' });
ok(r.status === 401 && tableCalls().length === 0, 'unauthenticated list refused before any read');

// 2. the list is the caller's own, filtered by the session user in the query itself
reset();
r = await call(fn, { action: 'list', userId: UB, user_id: UB }, { token: A });
const q = urlOf(tableCalls()[0]);
ok(r.status === 200 && q?.searchParams.get('user_id') === `eq.${UA}`, 'query filtered by the session user, body user ids ignored');
ok(r.json.items.length === 2 && !JSON.stringify(r.json).includes('secret'), 'only own items, nothing of another user');
const img = r.json.items.find((i: any) => i.kind === 'image');
const vid = r.json.items.find((i: any) => i.kind === 'video');
ok(img?.url.includes('/object/sign/') && img.url.includes('token='), 'image by signed link');
ok(vid?.url.includes('/object/public/ai-generated-videos/v.mp4'), 'video by its public link');
ok(img.prompt === 'cup' && img.meta.aspectRatio === '1:1' && typeof img.createdAt === 'string' && !('user_id' in img) && !('path' in img), 'item carries prompt and meta, not owner or storage path');

// 3. pages: limit 1 gives a cursor, the next page continues from it
reset();
r = await call(fn, { action: 'list', limit: 1 }, { token: A });
ok(r.json.items.length === 1 && r.json.items[0].id === ID1 && r.json.next === '2026-10-28T10:00:03Z', 'first page and its cursor');
r = await call(fn, { action: 'list', limit: 1, before: r.json.next }, { token: A });
ok(r.json.items.length === 1 && r.json.items[0].id === ID2 && r.json.next === null, 'second page, no cursor after the last');
r = await call(fn, { action: 'list', kind: 'video' }, { token: A });
ok(r.json.items.length === 1 && r.json.items[0].kind === 'video', 'kind filter');

// 4. delete: another user's item is not found and stays; the owner's goes with its file
reset();
r = await call(fn, { action: 'delete', id: ID3 }, { token: A });
ok(r.status === 404 && rows.some((x) => x.id === ID3) && !fake.calls.some((c) => c.kind === 'storage'), "another user's item: not found, nothing removed");
reset();
r = await call(fn, { action: 'delete', id: 'not-a-uuid' }, { token: A });
ok(r.status === 400 && tableCalls().length === 0, 'malformed id refused');
reset();
r = await call(fn, { action: 'delete', id: ID1 }, { token: A });
const removed = fake.calls.find((c) => c.kind === 'storage' && c.name.startsWith('DELETE'));
ok(r.status === 200 && !rows.some((x) => x.id === ID1) && JSON.stringify(removed?.body ?? '').includes(`${UA}/a.png`), 'own item deleted with its file');
const del = urlOf(tableCalls().find((c) => c.name.startsWith('DELETE')));
ok(del?.searchParams.get('user_id') === `eq.${UA}`, 'delete also filtered by the session user');

// 5. user B sees only their own
reset();
r = await call(fn, { action: 'list' }, { token: B });
ok(r.json.items.length === 1 && r.json.items[0].id === ID3, 'the other user sees only their item');

done('user-assets');
