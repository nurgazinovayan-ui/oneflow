// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "admin-list-generations" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically — the dashboard actively refuses to
// let you set a secret with the SUPABASE_ prefix yourself, which is expected, not an error.
//
// Only this account may call this — same enforcement pattern as admin-send-message/
// admin-list-online, checked against the caller's own verified JWT. Reads generation_log,
// which each generate-*/evaluate-creative Edge Function writes one row to after a successful,
// balance-deducted generation — but ALWAYS returns rows only for accounts whose email ends in
// "@mechta.kz", regardless of who else's generations are in the table. That filter lives here
// server-side, not in the client UI, so it can't be bypassed by calling the function directly.
//
// Requires the generation_log table — run this once in Supabase Studio's SQL editor:
//
//   create table if not exists generation_log (
//     id uuid primary key default gen_random_uuid(),
//     user_id uuid not null references auth.users(id) on delete cascade,
//     email text not null,
//     model text not null,
//     category text not null,
//     cost_usd numeric not null default 0,
//     created_at timestamptz not null default now()
//   );
//   alter table generation_log enable row level security;
//   -- No policies — only Edge Functions (service-role client, which bypasses RLS) touch this
//   -- table: each generate-*/evaluate-creative function writes to it, this one reads from it.
//   create index if not exists generation_log_email_idx on generation_log (email);
//   create index if not exists generation_log_created_at_idx on generation_log (created_at desc);

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const ADMIN_EMAIL = 'nurgazinov.ayan@gmail.com';
const MECHTA_DOMAIN = '@mechta.kz';
const MAX_ROWS = 2000;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    const { data: callerData } = await admin.auth.getUser(token);
    const caller = callerData.user;
    if (!caller || caller.email?.toLowerCase() !== ADMIN_EMAIL.toLowerCase()) {
      return new Response(JSON.stringify({ error: 'Доступ запрещён.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await admin
      .from('generation_log')
      .select('email, model, category, cost_usd, created_at')
      .ilike('email', `%${MECHTA_DOMAIN}`)
      .order('created_at', { ascending: false })
      .limit(MAX_ROWS);
    if (error) throw error;

    const rows = (data ?? []).map((r) => ({
      email: r.email as string,
      model: r.model as string,
      category: r.category as string,
      costUsd: (r.cost_usd as number) ?? 0,
      createdAt: r.created_at as string,
    }));

    return new Response(JSON.stringify(rows), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
