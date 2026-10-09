import { call, done, fake, load, ok, reset, token } from './harness.ts';
const A = token('user-a');
fake.users['user-a'] = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
const CH = '11111111-2222-3333-4444-555555555555';
fake.tables['messenger_members'] = (_m, url) => (url.searchParams.get('channel_id') === `eq.${CH}` ? [{ email: 'a@example.com' }] : []);
fake.tables['messenger_messages'] = () => [
  { id: 'm2', sender_email: 'b@example.com', body: 'report.pdf', created_at: '2', kind: 'file', file_size: 10, media_url: `http://sb.local/storage/v1/object/public/messenger-files/${CH}/uuid-report.pdf` },
  { id: 'm1', sender_email: 'b@example.com', body: '', created_at: '1', kind: 'gif', file_size: null, media_url: 'https://media.giphy.com/x.gif' },
];
await load('../../../supabase/functions/messenger-list-messages/index.ts');
reset();
let r = await call('messenger-list-messages', { channelId: CH }, { token: A });
const file = Array.isArray(r.json) ? r.json.find((m: any) => m.kind === 'file') : null;
const gif = Array.isArray(r.json) ? r.json.find((m: any) => m.kind === 'gif') : null;
ok(r.status === 200 && file && file.mediaUrl.includes('token=') && !file.mediaUrl.includes('/object/public/'), 'file links are signed, never the public path');
ok(gif?.mediaUrl === 'https://media.giphy.com/x.gif', 'GIF links unchanged');
ok(/[?&]download(=|&|$)/.test(file?.mediaUrl ?? ''), 'signed as downloads (Content-Disposition: attachment)');
reset();
r = await call('messenger-list-messages', { channelId: '99999999-2222-3333-4444-555555555555' }, { token: A });
ok(r.status === 403 && !fake.calls.some((c) => c.kind === 'storage'), 'non-member gets 403 and no signed links');
reset();
r = await call('messenger-list-messages', { channelId: CH });
ok(r.status === 403 || r.status === 401, 'no session → refused');
done('messenger-list-messages');
