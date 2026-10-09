// generate-video: async provider jobs — 202 + polling, ownership, one completion, failure refunds.
import { call, done, fake, load, ok, providerCalls, reset, rpcCalls, token } from './harness.ts';

const A = token('user-a');
const B = token('user-b');
fake.users['user-a'] = { id: 'aaaaaaaa-0000-0000-0000-000000000001', email: 'a@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
fake.users['user-b'] = { id: 'bbbbbbbb-0000-0000-0000-000000000002', email: 'b@example.com', email_confirmed_at: '2026-01-01T00:00:00Z' };
const JOB = 'cccccccc-1111-2222-3333-444444444444';

// in-memory reservations (what generation_reservations would hold)
const jobs: Record<string, { id: string; user: string; status: string; provider_job_id: string | null; amount_usd: number; result: unknown; model: string }> = {};
fake.rpc['reserve_generation_v2'] = (a) => {
  jobs[JOB] = { id: JOB, user: String(a.p_user), status: 'pending', provider_job_id: null, amount_usd: Number(a.p_amount), result: null, model: String(a.p_model) };
  return { id: JOB, replay: false, status: 'pending' };
};
fake.rpc['mark_generation_submitted'] = (a) => {
  const j = jobs[String(a.p_reservation)];
  if (j?.status !== 'pending') return false;
  j.status = 'submitted';
  j.provider_job_id = String(a.p_provider_job);
  return true;
};
fake.rpc['claim_generation_completion'] = (a) => {
  const j = jobs[String(a.p_reservation)];
  if (!j || j.user !== a.p_user || j.status !== 'submitted') return false;
  j.status = 'finishing';
  return true;
};
fake.rpc['settle_generation'] = (a) => {
  const j = jobs[String(a.p_reservation)];
  if (j && ['pending', 'submitted', 'finishing'].includes(j.status)) {
    j.status = 'settled';
    j.result = a.p_result;
  }
  return null;
};
fake.rpc['release_generation'] = (a) => {
  const j = jobs[String(a.p_reservation)];
  if (j && ['pending', 'submitted', 'finishing'].includes(j.status)) j.status = 'released';
  return null;
};
fake.tables['generation_reservations'] = (method, url) => {
  if (method !== 'GET') return [];
  const id = url.searchParams.get('id')?.replace('eq.', '');
  const user = url.searchParams.get('user_id')?.replace('eq.', '');
  const j = id ? jobs[id] : undefined;
  return j && j.user === user ? [{ id: j.id, status: j.status, provider_job_id: j.provider_job_id, amount_usd: j.amount_usd, result: j.result, model: j.model }] : [];
};

let providerState = 'in_progress';
fake.provider = (url, init) => {
  if (url.endsWith('/videos') && init.method === 'POST') return Response.json({ id: 'prov-job-1' });
  if (url.includes('/content')) return new Response(new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112]));
  return Response.json({ id: 'prov-job-1', status: providerState, usage: { cost: 0.63 } });
};
await load('../../../supabase/functions/generate-video/index.ts', {
  VIDEO_SYNC_WAIT_MS: '50',
  VIDEO_RESUME_WAIT_MS: '50',
  VIDEO_POLL_INTERVAL_MS: '10',
});
const fn = 'generate-video';
const body = { model: 'kwaivgi/kling-v3-video', prompt: 'a dog', resolution: '720p', duration: 5 };

// 1. submit: the provider accepted the job → 202 pending, budget held (not released, not settled)
reset();
let r = await call(fn, body, { token: A });
ok(r.status === 202 && r.json.pending === true && r.json.jobId === JOB, 'unfinished job answers 202 {pending, jobId}');
ok(jobs[JOB].status === 'submitted' && jobs[JOB].provider_job_id === 'prov-job-1', 'reservation marked submitted with the provider job id');
ok(rpcCalls('release_generation').length === 0 && rpcCalls('settle_generation').length === 0, 'submitted job is neither released nor charged yet');
ok(rpcCalls('reserve_generation_v2')[0]?.body?.p_amount === 0.63, 'reserved at the server estimate (0.126 × 5 s)');

// 2. another user cannot poll (or finish) the job
reset();
providerState = 'completed';
r = await call(fn, { jobId: JOB }, { token: B });
ok(r.status === 404 && providerCalls().length === 0 && rpcCalls('claim_generation_completion').length === 0, 'user B gets 404 for user A job');
reset();
r = await call(fn, { jobId: '../../etc/passwd' }, { token: A });
ok(r.status === 404 && providerCalls().length === 0, 'malformed job id → 404');

// 3. the owner polls: completed → one download, one settle with the result
reset();
r = await call(fn, { jobId: JOB }, { token: A });
ok(r.status === 200 && Array.isArray(r.json) && r.json.length === 1, 'owner receives the video URL');
ok(rpcCalls('settle_generation').length === 1 && rpcCalls('settle_generation')[0].body.p_cost === 0.63, 'settled once with the provider cost');
ok(jobs[JOB].status === 'settled', 'job settled');
// 4. polling again does not download or charge again
reset();
r = await call(fn, { jobId: JOB }, { token: A });
ok(r.status === 200 && rpcCalls('settle_generation').length === 0 && providerCalls().length === 0, 'repeated poll returns the stored result, no second charge');

// 5. a provider-side failure refunds the reservation
reset();
providerState = 'failed';
r = await call(fn, body, { token: A });
ok(r.status === 502 && jobs[JOB].status === 'released' && rpcCalls('settle_generation').length === 0, 'failed provider job → released, no charge');

// 6. network trouble while polling is NOT a failure: the job stays held
reset();
providerState = 'in_progress';
fake.provider = (url, init) => {
  if (url.endsWith('/videos') && init.method === 'POST') return Response.json({ id: 'prov-job-2' });
  throw new TypeError('network down');
};
r = await call(fn, body, { token: A });
ok(r.status === 202 && jobs[JOB].status === 'submitted' && rpcCalls('release_generation').length === 0, 'poll errors keep the job submitted (no free generation, no lost money)');

// 7. submit rejected by the provider → nothing billed, reservation released
reset();
fake.provider = () => new Response('bad request', { status: 400 });
r = await call(fn, body, { token: A });
ok(r.status === 500 && jobs[JOB].status === 'released', 'provider refused the submit → reservation released');

// 8. unknown model / no session
reset();
r = await call(fn, { ...body, model: 'evil/video' }, { token: A });
ok(r.status === 400 && rpcCalls('reserve_generation_v2').length === 0, 'unknown video model refused');
reset();
r = await call(fn, { jobId: JOB });
ok(r.status === 401, 'polling without a session → 401');

done('generate-video');
