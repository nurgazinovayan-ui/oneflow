// Test harness for the Edge Functions: imports the REAL function file with Deno.serve captured and
// every outgoing fetch answered by an in-memory fake of Supabase (Auth, REST, RPC, Storage) and of
// the AI providers. Nothing leaves the machine: no paid generation, no real database.
//
//   deno run -A tests/security/edge/<name>.test.ts

export type Rpc = (args: Record<string, unknown>) => unknown;
export interface Fake {
  users: Record<string, { id: string; email: string; email_confirmed_at: string | null }>;
  rpc: Record<string, Rpc>;
  tables: Record<string, (method: string, url: URL, body: unknown) => unknown>;
  provider: (url: string, init: RequestInit) => Response | Promise<Response>;
  calls: { kind: string; name: string; body?: any; url?: string; headers?: Record<string, string> }[];
  storage: { path: string; contentType: string | null }[];
}

export const fake: Fake = {
  users: {},
  rpc: {},
  tables: {},
  provider: () => new Response('no provider configured', { status: 599 }),
  calls: [],
  storage: [],
};

// A JWT-shaped token whose payload carries the claims the admin check reads (aal).
export function token(name: string, claims: Record<string, unknown> = {}): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'none' })}.${b64({ sub: name, ...claims })}.${name}`;
}

globalThis.fetch = (async (input: Request | URL | string, init: RequestInit = {}) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const headers: Record<string, string> = {};
  new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => (headers[k] = v));
  let body: any = init.body;
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      // keep text
    }
  }
  if (url.startsWith('http://sb.local')) {
    const u = new URL(url);
    if (u.pathname === '/auth/v1/user') {
      const tok = (headers['authorization'] ?? '').replace(/^Bearer\s+/i, '');
      const sig = tok.split('.')[2] ?? '';
      const user = fake.users[sig];
      fake.calls.push({ kind: 'auth', name: sig });
      return user ? Response.json(user) : Response.json({ msg: 'invalid JWT' }, { status: 401 });
    }
    if (u.pathname.startsWith('/rest/v1/rpc/')) {
      const name = u.pathname.slice('/rest/v1/rpc/'.length);
      fake.calls.push({ kind: 'rpc', name, body, headers });
      const fn = fake.rpc[name];
      if (!fn) return Response.json(null);
      try {
        const out = await fn(body ?? {});
        if (out instanceof Response) return out;
        return Response.json(out ?? null);
      } catch (err) {
        return Response.json({ message: String(err), code: 'P0001' }, { status: 400 });
      }
    }
    if (u.pathname.startsWith('/rest/v1/')) {
      const table = u.pathname.slice('/rest/v1/'.length);
      const method = (init.method ?? 'GET').toUpperCase();
      fake.calls.push({ kind: 'table', name: `${method} ${table}`, body, url });
      const fn = fake.tables[table];
      const out = fn ? await fn(method, u, body) : [];
      const wantsObject = (headers['accept'] ?? '').includes('vnd.pgrst.object');
      if (wantsObject) {
        const row = Array.isArray(out) ? out[0] : out;
        return row ? Response.json(row) : Response.json({ message: 'no rows' }, { status: 406 });
      }
      return Response.json(out ?? []);
    }
    if (u.pathname.startsWith('/storage/v1/')) {
      const method = (init.method ?? 'GET').toUpperCase();
      fake.calls.push({ kind: 'storage', name: `${method} ${u.pathname}`, body: typeof body === 'object' ? body : undefined, url });
      if (u.pathname.startsWith('/storage/v1/object/sign/')) {
        if (body && Array.isArray(body.paths)) return Response.json(body.paths.map((p: string) => ({ path: p, signedURL: `/object/sign/x/${p}?token=t`, error: null })));
        return Response.json({ signedURL: `${u.pathname.replace('/storage/v1', '')}?token=t` });
      }
      if (method === 'POST' || method === 'PUT') {
        const ct = headers['content-type'] ?? null;
        let contentType = ct;
        if (body instanceof FormData) {
          const f = body.get('') ?? [...body.values()].find((v) => v instanceof Blob);
          contentType = f instanceof Blob ? f.type || null : ct;
        } else if (body instanceof Blob) {
          contentType = body.type || ct;
        }
        fake.storage.push({ path: u.pathname, contentType });
        return Response.json({ Key: u.pathname });
      }
      return Response.json({});
    }
    return new Response('unknown fake route ' + url, { status: 404 });
  }
  if (/openrouter\.ai|openai\.com|replicate\.com|apify\.com|yandex|giphy|alerts\.test/.test(url)) {
    fake.calls.push({ kind: 'provider', name: url, body, headers });
    return await fake.provider(url, init);
  }
  // nothing may leave the machine: an unexpected destination is a test failure, not a real request
  throw new Error(`harness: unexpected outbound request to ${url}`);
}) as typeof fetch;

let handler: ((req: Request) => Promise<Response>) | null = null;
(Deno as any).serve = (h: any) => {
  handler = typeof h === 'function' ? h : h.handler;
  return { finished: Promise.resolve(), shutdown() {} };
};

export async function load(path: string, env: Record<string, string> = {}): Promise<void> {
  Deno.env.set('SUPABASE_URL', 'http://sb.local');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'service-role-test');
  Deno.env.set('OPENROUTER_API_KEY', 'test-openrouter-key');
  for (const [k, v] of Object.entries(env)) Deno.env.set(k, v);
  await import(new URL(path, import.meta.url).href);
  if (!handler) throw new Error('Deno.serve was not called by ' + path);
}

export async function call(
  path: string,
  body: unknown,
  opts: { token?: string; headers?: Record<string, string>; raw?: BodyInit; method?: string } = {}
): Promise<{ status: number; json: any; headers: Headers }> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...(opts.headers ?? {}) };
  if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
  const req = new Request(`http://fn.local/functions/v1/${path}`, {
    method: opts.method ?? 'POST',
    headers,
    body: opts.raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const res = await handler!(req);
  const text = await res.text();
  let json: any = text;
  try {
    json = JSON.parse(text);
  } catch {
    // keep text
  }
  return { status: res.status, json, headers: res.headers };
}

let failures = 0;
export function ok(cond: unknown, name: string): void {
  if (cond) console.log(`  ok - ${name}`);
  else {
    failures++;
    console.log(`  FAILED - ${name}`);
  }
}
export function reset(): void {
  fake.calls.length = 0;
  fake.storage.length = 0;
}
export const rpcCalls = (name: string) => fake.calls.filter((c) => c.kind === 'rpc' && c.name === name);
export const providerCalls = () => fake.calls.filter((c) => c.kind === 'provider');
export function done(label: string): void {
  if (failures) {
    console.log(`${label}: ${failures} FAILED`);
    Deno.exit(1);
  }
  console.log(`${label}: all passed`);
  Deno.exit(0);
}
