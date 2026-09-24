// Deploy in Supabase Studio → Edge Functions → Create a new function → name it
// "messenger-contacts" → paste this file → Deploy. Keep "Verify JWT" ON (default).
// No secrets to configure: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are reserved names that
// Supabase injects into every Edge Function automatically.
//
// Contacts by invitation («Пригласить соавтора»). One function, several actions, so there is
// only one thing to deploy:
//   { action: 'invite',  email }        → { status: 'sent' | 'already' | 'accepted' }
//   { action: 'list' }                  → { incoming: Invite[], outgoing: Invite[] }
//   { action: 'respond', id, accept }   → { status: 'accepted' | 'declined' }
//   { action: 'cancel',  id }           → { ok: true }
//
// Privacy: 'invite' answers the same "sent" whether or not the address has an account, so the
// form can't be used to probe who is registered. The invite is stored either way — a person who
// signs up later with that email sees it on their first visit. Other rules:
//   * one live link per pair (unique index in the migration); inviting someone who already
//     invited you accepts their invite instead of making a second one;
//   * colleagues (@mechta.kz / the owner) already see each other, so inviting one is "already";
//   * after a decline, the same sender's repeat invites are swallowed for DECLINE_COOLDOWN_DAYS
//     (still answered "sent" — the sender isn't told they were declined);
//   * at most INVITES_PER_DAY new invites per sender per 24h;
//   * incoming invites are only shown to, and answerable by, an account whose email is
//     confirmed — whoever holds an unconfirmed sign-up for someone else's address sees nothing.
//
// Requires supabase/migrations/202609240001_messenger_contacts.sql.

import { createClient } from 'npm:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const MECHTA_DOMAIN = '@mechta.kz';
const ADMIN_EMAIL = 'nurgazinov.ayan@gmail.com';
const INVITES_PER_DAY = 20;
const DECLINE_COOLDOWN_DAYS = 7;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isColleague(email: string): boolean {
  return email.endsWith(MECHTA_DOMAIN) || email === ADMIN_EMAIL;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
function jsonError(message: string, status: number) {
  return json({ error: message }, status);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: corsHeaders });
  try {
    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: callerData } = await admin.auth.getUser(token);
    const caller = callerData.user;
    const me = caller?.email?.toLowerCase() ?? '';
    if (!caller || !me.includes('@')) return jsonError('Доступ запрещён.', 403);
    const confirmed = !!caller.email_confirmed_at;

    const body = await req.json().catch(() => ({}));
    const action = typeof body?.action === 'string' ? body.action : '';

    if (action === 'invite') {
      const to = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
      if (!EMAIL_RE.test(to) || to.length > 320) return jsonError('Введите корректный адрес почты.', 400);
      if (to === me) return jsonError('Нельзя пригласить самого себя.', 400);
      if (isColleague(me) && isColleague(to)) return json({ status: 'already' });

      const [mine, theirs] = await Promise.all([
        admin.from('messenger_invites').select('id, status, responded_at').eq('from_email', me).eq('to_email', to)
          .order('created_at', { ascending: false }).limit(5),
        admin.from('messenger_invites').select('id, status').eq('from_email', to).eq('to_email', me)
          .in('status', ['pending', 'accepted']).limit(1),
      ]);
      if (mine.error) throw mine.error;
      if (theirs.error) throw theirs.error;

      const reverse = theirs.data?.[0] as { id: string; status: string } | undefined;
      if (reverse?.status === 'accepted') return json({ status: 'already' });
      if (reverse?.status === 'pending') {
        // They invited me first — sending one back means yes.
        const { error } = await admin.from('messenger_invites')
          .update({ status: 'accepted', responded_at: new Date().toISOString() }).eq('id', reverse.id);
        if (error) throw error;
        return json({ status: 'accepted' });
      }

      const own = (mine.data ?? []) as { id: string; status: string; responded_at: string | null }[];
      if (own.some((r) => r.status === 'accepted')) return json({ status: 'already' });
      if (own.some((r) => r.status === 'pending')) return json({ status: 'sent' });
      const cooldownStart = Date.now() - DECLINE_COOLDOWN_DAYS * 86_400_000;
      if (own.some((r) => r.status === 'declined' && r.responded_at && new Date(r.responded_at).getTime() > cooldownStart)) {
        return json({ status: 'sent' });
      }

      const since = new Date(Date.now() - 86_400_000).toISOString();
      const { count, error: countErr } = await admin.from('messenger_invites')
        .select('id', { count: 'exact', head: true }).eq('from_email', me).gte('created_at', since);
      if (countErr) throw countErr;
      if ((count ?? 0) >= INVITES_PER_DAY) return jsonError('Слишком много приглашений за сутки. Попробуйте завтра.', 429);

      const { error: insErr } = await admin.from('messenger_invites').insert({ from_email: me, to_email: to });
      // 23505: a concurrent request created the live link first — same outcome for the sender.
      if (insErr && insErr.code !== '23505') throw insErr;
      return json({ status: 'sent' });
    }

    if (action === 'list') {
      const [incoming, outgoing] = await Promise.all([
        confirmed
          ? admin.from('messenger_invites').select('id, from_email, created_at').eq('to_email', me).eq('status', 'pending')
            .order('created_at', { ascending: false }).limit(50)
          : Promise.resolve({ data: [], error: null }),
        admin.from('messenger_invites').select('id, to_email, created_at').eq('from_email', me).eq('status', 'pending')
          .order('created_at', { ascending: false }).limit(50),
      ]);
      if (incoming.error) throw incoming.error;
      if (outgoing.error) throw outgoing.error;
      const inRows = (incoming.data ?? []) as { id: string; from_email: string; created_at: string }[];
      const outRows = (outgoing.data ?? []) as { id: string; to_email: string; created_at: string }[];

      const emails = [...new Set([...inRows.map((r) => r.from_email), ...outRows.map((r) => r.to_email)])];
      const names = new Map<string, string>();
      if (emails.length) {
        const { data: profiles, error } = await admin.from('messenger_profiles').select('email, display_name').in('email', emails);
        if (error) throw error;
        for (const p of (profiles ?? []) as { email: string; display_name: string }[]) names.set(p.email, p.display_name);
      }
      const nameOf = (e: string) => names.get(e) || e.split('@')[0];
      return json({
        incoming: inRows.map((r) => ({ id: r.id, email: r.from_email, displayName: nameOf(r.from_email), createdAt: r.created_at })),
        // The invitee's profile name would reveal that the address is registered — outgoing rows
        // show only the address the sender typed.
        outgoing: outRows.map((r) => ({ id: r.id, email: r.to_email, displayName: r.to_email, createdAt: r.created_at })),
      });
    }

    if (action === 'respond') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!UUID_RE.test(id)) return jsonError('Приглашение не найдено.', 404);
      if (!confirmed) return jsonError('Подтвердите почту, чтобы принимать приглашения.', 403);
      const status = body?.accept === true ? 'accepted' : 'declined';
      const { data, error } = await admin.from('messenger_invites')
        .update({ status, responded_at: new Date().toISOString() })
        .eq('id', id).eq('to_email', me).eq('status', 'pending')
        .select('id');
      if (error) throw error;
      if (!data?.length) return jsonError('Приглашение не найдено или уже обработано.', 404);
      return json({ status });
    }

    if (action === 'cancel') {
      const id = typeof body?.id === 'string' ? body.id : '';
      if (!UUID_RE.test(id)) return jsonError('Приглашение не найдено.', 404);
      const { error } = await admin.from('messenger_invites').delete()
        .eq('id', id).eq('from_email', me).eq('status', 'pending');
      if (error) throw error;
      return json({ ok: true });
    }

    return jsonError('Неизвестное действие.', 400);
  } catch (err) {
    return jsonError(String(err), 500);
  }
});
