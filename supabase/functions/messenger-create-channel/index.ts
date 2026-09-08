// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-create-channel" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically.
//
// Body: { kind: 'dm' | 'group', title?: string, memberEmails: string[] }
// For a DM, memberEmails must contain exactly one other @mechta.kz address; an existing DM
// between the same two people is reused instead of creating a duplicate. For a group,
// memberEmails is everyone besides the caller and a non-empty title is required. Every email
// (the caller's own JWT included) is re-validated against @mechta.kz here — the client's
// dropdown of "who to message" is just UX, this is what actually enforces it.
//
// Requires supabase/migrations/202609070003_messenger.sql to have been applied first.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MECHTA_DOMAIN = '@mechta.kz';
const MECHTA_EMAIL_RE = /^[^@\s]+@mechta\.kz$/i;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function jsonError(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '');

    const { data: callerData } = await admin.auth.getUser(token);
    const caller = callerData.user;
    const callerEmail = caller?.email?.toLowerCase() ?? '';
    if (!caller || !callerEmail.endsWith(MECHTA_DOMAIN)) return jsonError('Доступ запрещён.', 403);

    const body = await req.json().catch(() => ({}));
    const kind = body?.kind === 'group' ? 'group' : body?.kind === 'dm' ? 'dm' : null;
    const memberEmails: string[] = Array.isArray(body?.memberEmails)
      ? [...new Set(body.memberEmails.filter((e: unknown) => typeof e === 'string').map((e: string) => e.toLowerCase().trim()))]
      : [];
    if (!kind) return jsonError('kind должен быть dm или group.', 400);
    if (memberEmails.some((e) => !MECHTA_EMAIL_RE.test(e))) return jsonError('Все участники должны быть с почтой @mechta.kz.', 400);

    if (kind === 'dm') {
      const other = memberEmails.find((e) => e !== callerEmail);
      if (!other || memberEmails.length !== 1) return jsonError('Для личного чата нужен ровно один собеседник.', 400);

      const { data: mine, error: mineErr } = await admin.from('messenger_members').select('channel_id').eq('email', callerEmail);
      if (mineErr) throw mineErr;
      const myChannelIds = (mine ?? []).map((r: { channel_id: string }) => r.channel_id);
      if (myChannelIds.length > 0) {
        const { data: myDmChannels, error: dmErr } = await admin
          .from('messenger_channels')
          .select('id')
          .in('id', myChannelIds)
          .eq('kind', 'dm');
        if (dmErr) throw dmErr;
        const myDmChannelIds = (myDmChannels ?? []).map((r: { id: string }) => r.id);
        if (myDmChannelIds.length > 0) {
          const { data: shared, error: sharedErr } = await admin
            .from('messenger_members')
            .select('channel_id')
            .eq('email', other)
            .in('channel_id', myDmChannelIds)
            .limit(1)
            .maybeSingle();
          if (sharedErr) throw sharedErr;
          if (shared) {
            return new Response(JSON.stringify({ id: shared.channel_id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
          }
        }
      }

      const { data: created, error: createErr } = await admin
        .from('messenger_channels')
        .insert({ kind: 'dm', title: '', created_by: callerEmail })
        .select('id')
        .single();
      if (createErr) throw createErr;
      const { error: memErr } = await admin.from('messenger_members').insert([
        { channel_id: created.id, email: callerEmail },
        { channel_id: created.id, email: other },
      ]);
      if (memErr) throw memErr;
      return new Response(JSON.stringify({ id: created.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 120) : '';
    const others = memberEmails.filter((e) => e !== callerEmail);
    if (!title) return jsonError('У группы должно быть название.', 400);
    if (others.length === 0) return jsonError('Добавьте хотя бы одного участника.', 400);

    const { data: created, error: createErr } = await admin
      .from('messenger_channels')
      .insert({ kind: 'group', title, created_by: callerEmail })
      .select('id')
      .single();
    if (createErr) throw createErr;
    const { error: memErr } = await admin
      .from('messenger_members')
      .insert([callerEmail, ...others].map((email) => ({ channel_id: created.id, email })));
    if (memErr) throw memErr;
    return new Response(JSON.stringify({ id: created.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return jsonError(String(err), 500);
  }
});
