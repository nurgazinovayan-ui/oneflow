// get-openrouter-balance (shared account data) and the admin check: owner only, optional MFA.
import { call, done, fake, load, ok, providerCalls, reset, token } from './harness.ts';

fake.users['user-a'] = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
fake.users['owner-aal1'] = { id: 'eeeeeeee-0000-0000-0000-000000000005', email: 'nurgazinov.ayan@gmail.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
fake.users['owner-aal2'] = fake.users['owner-aal1'];
fake.users['owner-unconfirmed'] = { ...fake.users['owner-aal1'], email_confirmed_at: null };
fake.provider = () => Response.json({ data: { usage: 12.5, limit: 100 } });
await load('../../../supabase/functions/get-openrouter-balance/index.ts', { ADMIN_REQUIRE_MFA: '1' });

reset();
let r = await call('get-openrouter-balance', {}, { token: token('user-a', { aal: 'aal2' }) });
ok(r.status === 403 && providerCalls().length === 0, 'an ordinary user cannot read the shared provider balance');
reset();
r = await call('get-openrouter-balance', {});
ok(r.status === 403 && providerCalls().length === 0, 'no session → refused');
reset();
r = await call('get-openrouter-balance', {}, { token: token('owner-unconfirmed', { aal: 'aal2' }) });
ok(r.status === 403, 'unconfirmed owner e-mail is not an admin');
reset();
r = await call('get-openrouter-balance', {}, { token: token('owner-aal1', { aal: 'aal1' }) });
ok(r.status === 403 && providerCalls().length === 0, 'with ADMIN_REQUIRE_MFA=1 a password-only session is refused');
reset();
r = await call('get-openrouter-balance', {}, { token: token('owner-aal2', { aal: 'aal2' }) });
ok(r.status === 200 && r.json.totalUsage === 12.5, 'owner with MFA (aal2) gets the balance');
done('admin-access');
