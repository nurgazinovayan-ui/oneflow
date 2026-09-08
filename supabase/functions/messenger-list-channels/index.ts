// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-list-channels" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically.
//
// Returns the caller's DM/group channels with their members and a last-message preview, in one
// round trip. Restricted to @mechta.kz callers, checked against the caller's own verified JWT.
//
// Requires supabase/migrations/202609070003_messenger.sql to have been applied first.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MECHTA_DOMAIN = '@mechta.kz';
const ONLINE_WINDOW_SECONDS = 45;
const RECENT_MESSAGES_SCANNED = 1000; // enough to find each channel's latest message in one query

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
    const callerEmail = caller?.email?.toLowerCase() ?? '';
    if (!caller || !callerEmail.endsWith(MECHTA_DOMAIN)) {
      return new Response(JSON.stringify({ error: 'Доступ запрещён.' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: myMemberships, error: memberErr } = await admin
      .from('messenger_members')
      .select('channel_id')
      .eq('email', callerEmail);
    if (memberErr) throw memberErr;
    const channelIds = [...new Set((myMemberships ?? []).map((m: { channel_id: string }) => m.channel_id))];
    if (channelIds.length === 0) {
      return new Response(JSON.stringify([]), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const [{ data: channels, error: chErr }, { data: allMembers, error: allMemErr }, { data: profiles, error: profErr }, { data: recent, error: msgErr }] =
      await Promise.all([
        admin.from('messenger_channels').select('id, kind, title, created_at').in('id', channelIds),
        admin.from('messenger_members').select('channel_id, email').in('channel_id', channelIds),
        admin.from('messenger_profiles').select('email, display_name, last_seen_at'),
        admin
          .from('messenger_messages')
          .select('channel_id, sender_email, body, created_at')
          .in('channel_id', channelIds)
          .order('created_at', { ascending: false })
          .limit(RECENT_MESSAGES_SCANNED),
      ]);
    if (chErr) throw chErr;
    if (allMemErr) throw allMemErr;
    if (profErr) throw profErr;
    if (msgErr) throw msgErr;

    const since = Date.now() - ONLINE_WINDOW_SECONDS * 1000;
    const profileByEmail = new Map(
      (profiles ?? []).map((p: { email: string; display_name: string; last_seen_at: string }) => [
        p.email,
        { displayName: p.display_name || p.email.split('@')[0], online: new Date(p.last_seen_at).getTime() >= since },
      ])
    );
    const membersByChannel = new Map<string, string[]>();
    for (const m of allMembers ?? []) {
      const list = membersByChannel.get(m.channel_id) ?? [];
      list.push(m.email);
      membersByChannel.set(m.channel_id, list);
    }
    const lastMessageByChannel = new Map<string, { body: string; senderEmail: string; createdAt: string }>();
    for (const msg of recent ?? []) {
      if (!lastMessageByChannel.has(msg.channel_id)) {
        lastMessageByChannel.set(msg.channel_id, { body: msg.body, senderEmail: msg.sender_email, createdAt: msg.created_at });
      }
    }

    const result = (channels ?? [])
      .map((c: { id: string; kind: string; title: string; created_at: string }) => {
        const memberEmails = membersByChannel.get(c.id) ?? [];
        const members = memberEmails.map((email) => ({
          email,
          displayName: profileByEmail.get(email)?.displayName ?? email.split('@')[0],
          online: profileByEmail.get(email)?.online ?? false,
          isSelf: email === callerEmail,
        }));
        const lastMessage = lastMessageByChannel.get(c.id) ?? null;
        return {
          id: c.id,
          kind: c.kind,
          title: c.title,
          members,
          lastMessage,
          sortKey: lastMessage?.createdAt ?? c.created_at,
        };
      })
      .sort((a, b) => (a.sortKey < b.sortKey ? 1 : -1));

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
