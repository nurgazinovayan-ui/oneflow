import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '../i18n';
import { IconChat, IconClose, IconSend, IconPlus, IconSearch, IconChevronRight, IconAttach, IconCheck, IconDocument, IconDownload, IconEdit } from './Icons';
import {
  heartbeat, getRoster, listChannels, startDm, createGroup, listMessages, sendMessage, sendSticker, sendGif, searchGifs,
  markReadServer, sendFile, messageReadByOthers, inviteContact, listInvites, respondInvite, cancelInvite,
  type RosterEntry, type ChannelSummary, type ChatMessage, type MessengerStatus, type GifResult, type InviteList,
} from '../messenger/client';

const HEARTBEAT_MS = 20_000;
const POLL_MS = 4_000;
const BACKGROUND_POLL_MS = 15_000; // keeps the unread badge + facepile roster live while the widget is closed or on another tab
const GIF_SEARCH_DEBOUNCE_MS = 400;
// Incoming contact invites are polled on their own clock, open or closed, so the green prompt
// shows up in the corner wherever the person is in the app.
const INVITE_POLL_MS = 15_000;
const ACCEPTED_TOAST_MS = 4_000;
const MAX_INVITE_TOASTS = 3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const READ_KEY_PREFIX = 'oneflow-messenger-read:';
// 30 pre-made avatar illustrations (public/avatars/avatar-01.png..avatar-30.png) — every person
// gets one deterministically (hashed from their email, see avatarImage below), rather than the
// same person's avatar changing on every render/reload.
const AVATAR_COUNT = 30;
const STICKERS = ['🎉', '😂', '❤️', '👍', '🔥', '😢', '😮', '🙏', '💯', '✅', '❌', '🤔', '🥳', '😍', '😅', '🙌', '👏', '😴', '🤝', '💪', '🚀', '☕', '😎', '🤯'];
const MAX_FACEPILE_AVATARS = 4;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

// Chats are split by kind (by request) — one-to-one conversations and groups each get their own
// tab rather than sharing one mixed list, where a group row and a DM row read the same at a glance.
type View = 'direct' | 'groups' | 'people' | 'newGroup';
// Consecutive messages from the same sender this close together render as one run: the name
// (in groups) shows once at the top, the avatar once at the bottom, and the bubbles sit tighter.
const RUN_GAP_MS = 5 * 60_000;
type Translations = ReturnType<typeof useT>['messenger'];

function timeLabel(iso: string, locale: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale, { day: '2-digit', month: '2-digit' });
}

function formatFileSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function clockLabel(iso: string, locale: string): string {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso: string, t: Translations): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86_400_000);
  if (d.toDateString() === today.toDateString()) return t.today;
  if (d.toDateString() === yesterday.toDateString()) return t.yesterday;
  return d.toLocaleDateString(t.locale, {
    day: 'numeric', month: 'long', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

function hashOf(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return hash;
}

// Stable per-person hue slot (0-5) for sender names in group threads — the same colleague always
// reads in the same color, which is what makes a busy group scannable. CSS maps the slot to a hue
// tuned separately for each theme (see .messenger-sender).
function senderHue(email: string): number {
  return hashOf(email) % 6;
}

function groupInitials(title: string): string {
  const words = title.split(/\s+/).filter(w => /[\p{L}\p{N}]/u.test(w));
  return words.slice(0, 2).map(w => [...w][0]).join('').toUpperCase() || '#';
}

function lastActivity(c: ChannelSummary): string {
  return c.lastMessage?.createdAt ?? '';
}

function channelLabel(channel: ChannelSummary, myEmail: string): string {
  if (channel.kind === 'group') return channel.title;
  const other = channel.members.find(m => m.email !== myEmail);
  return other?.displayName ?? channel.title;
}

function avatarImage(email: string): string {
  const n = (hashOf(email) % AVATAR_COUNT) + 1;
  return `/avatars/avatar-${String(n).padStart(2, '0')}.png`;
}

function statusLabel(t: Translations, status: MessengerStatus): string {
  if (status === 'generating') return t.statusGenerating;
  if (status === 'copywriting') return t.statusCopywriting;
  if (status === 'evaluating') return t.statusEvaluating;
  return t.statusIdle;
}

function loadReadMap(email: string): Record<string, string> {
  try { return JSON.parse(localStorage.getItem(READ_KEY_PREFIX + email) ?? '{}'); }
  catch { return {}; }
}
function saveReadMap(email: string, map: Record<string, string>) {
  try { localStorage.setItem(READ_KEY_PREFIX + email, JSON.stringify(map)); }
  catch { /* per-device convenience only; a full page reload just re-derives from the server */ }
}

function Avatar({ name, email, online, small }: { name: string; email: string; online: boolean; small?: boolean }) {
  return <span className={`messenger-avatar ${online ? 'is-online' : 'is-offline'}${small ? ' is-small' : ''}`}>
    <img src={avatarImage(email)} alt={name || email} className="messenger-avatar-img" />
    <span className="messenger-avatar-dot" />
  </span>;
}

// Groups get a rounded-square initials tile instead of a person's round avatar — the shape alone
// tells a group row from a one-to-one row, and every row keeps the same left column so titles
// line up (group rows used to have no avatar at all and jutted left).
function GroupAvatar({ title }: { title: string }) {
  return <span className="messenger-group-avatar" style={{ '--hue': hashOf(title) % 6 } as CSSProperties} aria-hidden="true">
    {groupInitials(title)}
  </span>;
}

export default function MessengerWidget({ email, activity }: { email: string; activity: MessengerStatus }) {
  const t = useT().messenger;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('direct');
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [channels, setChannels] = useState<ChannelSummary[] | null>(null);
  const [roster, setRoster] = useState<RosterEntry[] | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [peopleQuery, setPeopleQuery] = useState('');
  const [groupTitle, setGroupTitle] = useState('');
  const [groupMembers, setGroupMembers] = useState<string[]>([]);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nameDraft, setNameDraft] = useState('');
  const [editingName, setEditingName] = useState(false);
  const [readMap, setReadMap] = useState<Record<string, string>>(() => loadReadMap(email));
  const [stickerPickerOpen, setStickerPickerOpen] = useState(false);
  const [gifPickerOpen, setGifPickerOpen] = useState(false);
  const [gifQuery, setGifQuery] = useState('');
  const [gifResults, setGifResults] = useState<GifResult[] | null>(null);
  const [gifLoading, setGifLoading] = useState(false);
  const [fileSending, setFileSending] = useState(false);
  const [invites, setInvites] = useState<InviteList | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteNote, setInviteNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [dismissedInvites, setDismissedInvites] = useState<Set<string>>(() => new Set());
  const [respondingId, setRespondingId] = useState<string | null>(null);
  const [acceptedToast, setAcceptedToast] = useState<string | null>(null);
  const activeChannelRef = useRef<string | null>(null);
  const activityRef = useRef(activity);
  const messagesRef = useRef<ChatMessage[]>(messages);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  activeChannelRef.current = activeChannelId;
  activityRef.current = activity;
  messagesRef.current = messages;

  // Every path that adds messages goes through here, de-duplicated by id. Two requests can return
  // the same message: on opening a chat the poll and openThread() both fetch the full history at
  // once, and a poll already in flight when you send can come back with the message you just sent
  // — whichever lands second used to append it again.
  const appendMessages = (incoming: ChatMessage[]) => {
    setMessages(prev => {
      const seen = new Set(prev.map(m => m.id));
      const added = incoming.filter(m => !seen.has(m.id));
      return added.length ? [...prev, ...added] : prev;
    });
  };

  const markRead = (channelId: string, at: string) => {
    setReadMap(prev => {
      if (prev[channelId] && prev[channelId] >= at) return prev;
      const next = { ...prev, [channelId]: at };
      saveReadMap(email, next);
      return next;
    });
  };

  useEffect(() => { void heartbeat(undefined, activity); }, [activity]);

  useEffect(() => {
    const id = window.setInterval(() => void heartbeat(undefined, activityRef.current), HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, []);

  // Keeps the unread badge + facepile roster accurate while the panel is closed, or open on a
  // tab other than Chats — the fast poll below already refreshes channels every 4s in that one
  // case, so this steps aside instead of doubling up.
  useEffect(() => {
    if (open && (view === 'direct' || view === 'groups')) return;
    let cancelled = false;
    const poll = () => {
      void listChannels().then(list => { if (!cancelled) setChannels(list); }).catch(() => {});
      void getRoster().then(list => { if (!cancelled) setRoster(list); }).catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, BACKGROUND_POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
  }, [open, view]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        if (activeChannelRef.current) {
          // Read via the ref, not the `messages` state closed over when this effect last ran
          // (only when open/view/activeChannelId change) — otherwise this cursor stays frozen at
          // whatever the channel's history ended at on open, so every 4s tick re-fetches and
          // re-appends everything sent since then, duplicating each message on every poll.
          const current = messagesRef.current;
          const last = current.length ? current[current.length - 1].createdAt : undefined;
          const fresh = await listMessages(activeChannelRef.current, last);
          if (!cancelled && fresh.length) {
            appendMessages(fresh);
            markRead(activeChannelRef.current, fresh[fresh.length - 1].createdAt);
            void markReadServer(activeChannelRef.current).catch(() => {});
          }
        } else if (view === 'direct' || view === 'groups') {
          const list = await listChannels();
          if (!cancelled) setChannels(list);
        } else if (view === 'people') {
          const list = await getRoster();
          if (!cancelled) setRoster(list);
        }
      } catch { /* keep last known state; next poll retries */ }
    };
    void refresh();
    const id = window.setInterval(refresh, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, view, activeChannelId]);

  useEffect(() => { messagesEndRef.current?.scrollIntoView({ block: 'end' }); }, [messages]);

  useEffect(() => {
    if (!gifPickerOpen) return;
    let cancelled = false;
    setGifLoading(true);
    const id = window.setTimeout(() => {
      searchGifs(gifQuery).then(results => { if (!cancelled) setGifResults(results); })
        .catch(() => { if (!cancelled) setGifResults([]); })
        .finally(() => { if (!cancelled) setGifLoading(false); });
    }, gifQuery ? GIF_SEARCH_DEBOUNCE_MS : 0);
    return () => { cancelled = true; window.clearTimeout(id); };
  }, [gifPickerOpen, gifQuery]);

  const refreshInvites = () => listInvites().then(setInvites).catch(() => { /* next poll retries */ });

  useEffect(() => {
    void refreshInvites();
    const id = window.setInterval(() => void refreshInvites(), INVITE_POLL_MS);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!acceptedToast) return;
    const id = window.setTimeout(() => setAcceptedToast(null), ACCEPTED_TOAST_MS);
    return () => window.clearTimeout(id);
  }, [acceptedToast]);

  const submitInvite = async () => {
    const target = inviteEmail.trim().toLowerCase();
    if (!EMAIL_RE.test(target)) { setInviteNote({ ok: false, text: t.inviteInvalid }); return; }
    setInviteSending(true); setInviteNote(null);
    try {
      const result = await inviteContact(target);
      setInviteEmail('');
      setInviteNote({ ok: true, text: result === 'already' ? t.inviteAlready : result === 'accepted' ? t.inviteAccepted : t.inviteSent });
      void refreshInvites();
      if (result === 'accepted') void getRoster().then(setRoster).catch(() => {});
    } catch (e) {
      setInviteNote({ ok: false, text: e instanceof Error && e.message ? e.message : t.error });
    } finally { setInviteSending(false); }
  };

  const answerInvite = async (inviteId: string, accept: boolean, name: string) => {
    setRespondingId(inviteId);
    try {
      await respondInvite(inviteId, accept);
      setInvites(prev => prev && { ...prev, incoming: prev.incoming.filter(i => i.id !== inviteId) });
      if (accept) {
        setAcceptedToast(t.inviteAcceptedToast(name));
        void getRoster().then(setRoster).catch(() => {});
      }
    } catch { setError(true); } finally { setRespondingId(null); void refreshInvites(); }
  };

  const withdrawInvite = async (inviteId: string) => {
    setInvites(prev => prev && { ...prev, outgoing: prev.outgoing.filter(i => i.id !== inviteId) });
    try { await cancelInvite(inviteId); } catch { void refreshInvites(); }
  };

  const openThread = async (channelId: string) => {
    setActiveChannelId(channelId);
    setMessages([]);
    setError(false);
    markRead(channelId, new Date().toISOString());
    void markReadServer(channelId).catch(() => {});
    try {
      const history = await listMessages(channelId);
      setMessages(history);
      if (history.length) markRead(channelId, history[history.length - 1].createdAt);
    } catch { setError(true); }
  };

  const backToList = () => { setActiveChannelId(null); setMessages([]); };

  const openDm = async (otherEmail: string) => {
    setBusy(true); setError(false);
    try {
      const { id } = await startDm(otherEmail);
      setView('direct');
      await openThread(id);
      // Refreshes .channels right away so the just-opened thread's member list (and their
      // lastReadAt, for read receipts) is available immediately rather than waiting for the
      // next background/foreground poll.
      void listChannels().then(setChannels).catch(() => {});
    } catch { setError(true); } finally { setBusy(false); }
  };

  // Facepile avatars call this directly instead of opening the panel first — it opens the panel
  // and starts/resumes the DM with that person in one step.
  const startChatFromFacepile = async (otherEmail: string) => {
    setOpen(true);
    await openDm(otherEmail);
  };

  const submitGroup = async () => {
    if (!groupTitle.trim() || groupMembers.length === 0) return;
    setBusy(true); setError(false);
    try {
      const { id } = await createGroup(groupTitle.trim(), groupMembers);
      setGroupTitle(''); setGroupMembers([]); setView('groups');
      await openThread(id);
    } catch { setError(true); } finally { setBusy(false); }
  };

  const submitMessage = async () => {
    const text = draft.trim();
    if (!text || !activeChannelId) return;
    setDraft('');
    try {
      const created = await sendMessage(activeChannelId, text);
      appendMessages([created]);
      markRead(activeChannelId, created.createdAt);
    } catch { setError(true); setDraft(text); }
  };

  const pickSticker = async (emoji: string) => {
    if (!activeChannelId) return;
    setStickerPickerOpen(false);
    try {
      const created = await sendSticker(activeChannelId, emoji);
      appendMessages([created]);
      markRead(activeChannelId, created.createdAt);
    } catch { setError(true); }
  };

  const pickGif = async (url: string) => {
    if (!activeChannelId) return;
    setGifPickerOpen(false);
    try {
      const created = await sendGif(activeChannelId, url);
      appendMessages([created]);
      markRead(activeChannelId, created.createdAt);
    } catch { setError(true); }
  };

  const pickFile = async (file: File) => {
    if (!activeChannelId) return;
    if (file.size > MAX_FILE_BYTES) { window.alert(t.fileTooBig); return; }
    setFileSending(true);
    try {
      const created = await sendFile(activeChannelId, file);
      appendMessages([created]);
      markRead(activeChannelId, created.createdAt);
    } catch { setError(true); } finally { setFileSending(false); }
  };

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) { setEditingName(false); return; }
    setEditingName(false);
    try { await heartbeat(name); } catch { /* next heartbeat retries */ }
  };

  const activeChannel = channels?.find(c => c.id === activeChannelId) ?? null;
  const activeOther = activeChannel?.kind === 'dm' ? activeChannel.members.find(m => m.email !== email) : null;
  const filteredRoster = (roster ?? []).filter(p => !p.isSelf &&
    p.displayName.toLowerCase().includes(peopleQuery.toLowerCase()))
    .sort((a, b) => (a.online !== b.online ? (a.online ? -1 : 1) : a.displayName.localeCompare(b.displayName)));
  const hasContacts = !!roster && roster.some(p => !p.isSelf);
  const incomingInvites = invites?.incoming ?? [];
  const outgoingInvites = invites?.outgoing ?? [];
  const toastInvites = incomingInvites.filter(i => !dismissedInvites.has(i.id)).slice(0, MAX_INVITE_TOASTS);
  const onlinePeople = filteredRoster.filter(p => p.online);
  const offlinePeople = filteredRoster.filter(p => !p.online);
  const unreadChannelIds = new Set(
    (channels ?? [])
      .filter(c => c.lastMessage && c.lastMessage.senderEmail !== email &&
        (!readMap[c.id] || c.lastMessage.createdAt > readMap[c.id]))
      .map(c => c.id)
  );
  const unreadCount = unreadChannelIds.size;
  const badge = (n: number) => (n > 9 ? '9+' : `${n}`);
  const unreadLabel = unreadCount > 9 ? '9+' : `+${unreadCount}`;
  const byRecent = (a: ChannelSummary, b: ChannelSummary) => lastActivity(b).localeCompare(lastActivity(a));
  const directChannels = (channels ?? []).filter(c => c.kind === 'dm').sort(byRecent);
  const groupChannels = (channels ?? []).filter(c => c.kind === 'group').sort(byRecent);
  const unreadDirect = directChannels.filter(c => unreadChannelIds.has(c.id)).length;
  const unreadGroups = groupChannels.filter(c => unreadChannelIds.has(c.id)).length;
  const isGroupThread = activeChannel?.kind === 'group';
  const memberName = (senderEmail: string) =>
    activeChannel?.members.find(mm => mm.email === senderEmail)?.displayName || senderEmail.split('@')[0];
  const previewText = (c: ChannelSummary) => {
    const lm = c.lastMessage;
    if (!lm) return '';
    const who = lm.senderEmail === email ? t.you
      : c.kind === 'group' ? (c.members.find(mm => mm.email === lm.senderEmail)?.displayName.split(' ')[0] ?? '') : '';
    const body = lm.kind === 'gif' ? `\u{1F3AC} GIF${lm.body ? ' · ' + lm.body : ''}`
      : lm.kind === 'file' ? `\u{1F4CE} ${lm.body}` : lm.body;
    return who ? `${who}: ${body}` : body;
  };

  // Facepile trigger: online colleagues first, capped at MAX_FACEPILE_AVATARS with a "+N"
  // overflow circle (opens the full Colleagues list) beyond that.
  const facepileOthers = (roster ?? []).filter(p => !p.isSelf)
    .sort((a, b) => (a.online !== b.online ? (a.online ? -1 : 1) : a.displayName.localeCompare(b.displayName)));
  const facepileShown = facepileOthers.slice(0, MAX_FACEPILE_AVATARS);
  const facepileOverflow = facepileOthers.length - facepileShown.length;

  const inviteForm = (
    <form className="messenger-invite" noValidate onSubmit={e => { e.preventDefault(); void submitInvite(); }}>
      <p className="messenger-invite-title">{t.inviteTitle}</p>
      <p className="messenger-invite-hint">{t.inviteHint}</p>
      <input id="messenger-invite-email" type="email" inputMode="email" autoComplete="off" value={inviteEmail}
        onChange={e => { setInviteEmail(e.target.value); setInviteNote(null); }} placeholder={t.invitePlaceholder} aria-label={t.inviteTitle} />
      <button type="submit" className="messenger-primary" disabled={inviteSending || !inviteEmail.trim()}>
        {inviteSending ? t.inviteSending : t.inviteSend}
      </button>
      {inviteNote && <p className={`messenger-invite-note ${inviteNote.ok ? 'is-ok' : 'is-error'}`} role="status">{inviteNote.text}</p>}
    </form>
  );

  return <>
    {(toastInvites.length > 0 || acceptedToast) && <div className={`messenger-invite-toasts${open ? ' is-beside-panel' : ''}`} aria-live="polite">
      {toastInvites.map(inv => <div key={inv.id} className="messenger-invite-toast" role="status">
        <Avatar name={inv.displayName} email={inv.email} online={false} />
        <div className="messenger-invite-toast-body">
          <p className="messenger-invite-toast-title">{t.inviteToastTitle}</p>
          <p className="messenger-invite-toast-text">{t.inviteToastText(inv.displayName)}</p>
          <p className="messenger-invite-toast-email">{inv.email}</p>
          <div className="messenger-invite-toast-actions">
            <button type="button" className="is-accept" disabled={respondingId === inv.id}
              onClick={() => void answerInvite(inv.id, true, inv.displayName)}><IconCheck size={13} />{t.accept}</button>
            <button type="button" className="is-decline" disabled={respondingId === inv.id}
              onClick={() => void answerInvite(inv.id, false, inv.displayName)}>{t.decline}</button>
          </div>
        </div>
        <button type="button" className="messenger-invite-toast-close" aria-label={t.close}
          onClick={() => setDismissedInvites(prev => new Set(prev).add(inv.id))}><IconClose size={13} /></button>
      </div>)}
      {acceptedToast && <div className="messenger-invite-toast is-done" role="status">
        <span className="messenger-invite-toast-check"><IconCheck size={16} /></span>
        <p className="messenger-invite-toast-text">{acceptedToast}</p>
      </div>}
    </div>}
    <div className="messenger-facepile">
      {facepileShown.map(p => (
        <button key={p.email} type="button" className="messenger-facepile-avatar" title={p.displayName}
          onClick={() => void startChatFromFacepile(p.email)}>
          <Avatar name={p.displayName} email={p.email} online={p.online} />
        </button>
      ))}
      {facepileOverflow > 0 && (
        <button type="button" className="messenger-facepile-avatar messenger-facepile-more"
          aria-label={t.moreLabel(facepileOverflow)} onClick={() => { setView('people'); setOpen(true); }}>
          +{facepileOverflow}
        </button>
      )}
      <button type="button" className="messenger-facepile-avatar messenger-facepile-toggle"
        aria-label={open ? t.close : t.openMessenger} onClick={() => setOpen(v => !v)}>
        {open ? <IconClose size={18} /> : <IconChat size={18} />}
        {!open && unreadCount > 0 && <span className="messenger-badge">{unreadLabel}</span>}
      </button>
    </div>
    {open && <section className="messenger-panel" aria-label={t.title}>
      <header className="messenger-header">
        {activeChannelId
          ? <><button className="messenger-back" onClick={backToList} aria-label={t.back}><IconChevronRight size={14} /></button>
              <div className="messenger-header-title">
                <h2>{activeChannel ? channelLabel(activeChannel, email) : ''}</h2>
                {activeOther && <span className={`messenger-header-status${activeOther.online ? ' is-online' : ''}`}>{activeOther.online ? statusLabel(t, activeOther.status) : t.offline}</span>}
                {isGroupThread && activeChannel && <span className="messenger-header-status">
                  {t.groupMembers(activeChannel.members.length, activeChannel.members.filter(mm => mm.online).length)}
                </span>}
              </div></>
          : <h2>{t.title}</h2>}
        <button className="messenger-close" onClick={() => setOpen(false)} aria-label={t.close}><IconClose size={16} /></button>
      </header>

      {!activeChannelId && <nav className="messenger-tabs">
        <button aria-pressed={view === 'direct'} onClick={() => setView('direct')}>
          {t.tabDirect}{unreadDirect > 0 && <span className="messenger-tab-badge">{badge(unreadDirect)}</span>}
        </button>
        <button aria-pressed={view === 'groups' || view === 'newGroup'} onClick={() => setView('groups')}>
          {t.tabGroups}{unreadGroups > 0 && <span className="messenger-tab-badge">{badge(unreadGroups)}</span>}
        </button>
        <button aria-pressed={view === 'people'} onClick={() => setView('people')}>
          {t.tabPeople}{incomingInvites.length > 0 && <span className="messenger-tab-badge">{badge(incomingInvites.length)}</span>}
        </button>
      </nav>}

      {!activeChannelId && (view === 'direct' || view === 'groups') && <section className="messenger-list">
        {view === 'groups' && <button className="messenger-new-group" onClick={() => setView('newGroup')}><IconPlus size={14} />{t.newGroup}</button>}
        {channels && !(view === 'direct' ? directChannels : groupChannels).length && (roster && !hasContacts
          ? <><p className="messenger-empty messenger-empty-tight">{t.noContacts}</p>{inviteForm}</>
          : <p className="messenger-empty">{view === 'direct' ? t.noDirect : t.noGroups}</p>)}
        {(view === 'direct' ? directChannels : groupChannels).map(c => {
          const other = c.kind === 'dm' ? c.members.find(m => m.email !== email) : null;
          const unread = unreadChannelIds.has(c.id);
          return <button key={c.id} className={`messenger-row ${unread ? 'is-unread' : ''}`} onClick={() => void openThread(c.id)}>
            {c.kind === 'dm' && other ? <Avatar name={other.displayName} email={other.email} online={other.online} /> : <GroupAvatar title={c.title} />}
            <span className="messenger-row-body">
              <span className="messenger-row-top">
                <span className="messenger-row-title">{channelLabel(c, email)}</span>
                {c.lastMessage && <span className="messenger-row-time">{timeLabel(c.lastMessage.createdAt, t.locale)}</span>}
              </span>
              <span className="messenger-row-bottom">
                <span className="messenger-row-preview">{previewText(c)}</span>
                {unread && <span className="messenger-row-dot" aria-hidden="true" />}
              </span>
            </span>
          </button>;
        })}
      </section>}

      {!activeChannelId && view === 'people' && <section className="messenger-list">
        {incomingInvites.length > 0 && <div className="messenger-section">
          <h3 className="messenger-section-title">{t.invitesIncoming} <span>{incomingInvites.length}</span></h3>
          {incomingInvites.map(inv => <div key={inv.id} className="messenger-row messenger-invite-row">
            <Avatar name={inv.displayName} email={inv.email} online={false} />
            <span className="messenger-row-body">
              <span className="messenger-row-title">{inv.displayName}</span>
              <span className="messenger-row-preview">{inv.email}</span>
            </span>
            <span className="messenger-invite-row-actions">
              <button type="button" className="is-accept" aria-label={t.accept} title={t.accept} disabled={respondingId === inv.id}
                onClick={() => void answerInvite(inv.id, true, inv.displayName)}><IconCheck size={14} /></button>
              <button type="button" className="is-decline" aria-label={t.decline} title={t.decline} disabled={respondingId === inv.id}
                onClick={() => void answerInvite(inv.id, false, inv.displayName)}><IconClose size={13} /></button>
            </span>
          </div>)}
        </div>}
        {roster && !hasContacts
          ? <><p className="messenger-empty messenger-empty-tight">{t.noContacts}</p>{inviteForm}</>
          : inviteOpen
            ? inviteForm
            : <button className="messenger-new-group" onClick={() => { setInviteOpen(true); setInviteNote(null); }}><IconPlus size={14} />{t.inviteTitle}</button>}
        {hasContacts && <div className="messenger-search"><IconSearch size={14} /><input value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} placeholder={t.searchPeople} /></div>}
        {editingName
          ? <div className="messenger-name-edit">
              <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} placeholder={t.displayNamePrompt} autoFocus
                onKeyDown={e => e.key === 'Enter' && void saveName()} />
              <button onClick={() => void saveName()}>{t.save}</button>
            </div>
          : <button className="messenger-link" onClick={() => { setNameDraft(''); setEditingName(true); }}><IconEdit size={13} />{t.editName}</button>}
        {hasContacts && !filteredRoster.length && <p className="messenger-empty">{t.noPeople}</p>}
        {([[t.onlineSection, onlinePeople], [t.offlineSection, offlinePeople]] as const).map(([label, people]) => people.length > 0 && <div key={label} className="messenger-section">
          <h3 className="messenger-section-title">{label} <span>{people.length}</span></h3>
          {people.map(p => <button key={p.email} className="messenger-row" disabled={busy} onClick={() => void openDm(p.email)}>
            <Avatar name={p.displayName} email={p.email} online={p.online} />
            <span className="messenger-row-body">
              <span className="messenger-row-title">{p.displayName}</span>
              <span className="messenger-row-preview">{p.online ? statusLabel(t, p.status) : t.offline}</span>
            </span>
          </button>)}
        </div>)}
        {outgoingInvites.length > 0 && <div className="messenger-section">
          <h3 className="messenger-section-title">{t.invitesOutgoing} <span>{outgoingInvites.length}</span></h3>
          {outgoingInvites.map(inv => <div key={inv.id} className="messenger-row messenger-invite-row is-outgoing">
            <span className="messenger-invite-pending" aria-hidden="true">@</span>
            <span className="messenger-row-body">
              <span className="messenger-row-title">{inv.email}</span>
              <span className="messenger-row-preview">{timeLabel(inv.createdAt, t.locale)}</span>
            </span>
            <button type="button" className="messenger-invite-cancel" onClick={() => void withdrawInvite(inv.id)}>{t.cancelInvite}</button>
          </div>)}
        </div>}
      </section>}

      {!activeChannelId && view === 'newGroup' && <section className="messenger-list">
        <input className="messenger-group-title" value={groupTitle} onChange={e => setGroupTitle(e.target.value)} placeholder={t.groupTitlePlaceholder} />
        <p className="messenger-meta">{t.selectMembers} · {t.membersCount(groupMembers.length)}</p>
        {(roster ?? []).filter(p => !p.isSelf).map(p => <label key={p.email} className="messenger-checkbox-row">
          <input type="checkbox" checked={groupMembers.includes(p.email)}
            onChange={e => setGroupMembers(prev => e.target.checked ? [...prev, p.email] : prev.filter(v => v !== p.email))} />
          <Avatar name={p.displayName} email={p.email} online={p.online} />
          {p.displayName}
        </label>)}
        <footer className="messenger-form-actions">
          <button onClick={() => { setView('groups'); setGroupTitle(''); setGroupMembers([]); }}>{t.cancel}</button>
          <button className="messenger-primary" disabled={busy || !groupTitle.trim() || !groupMembers.length} onClick={() => void submitGroup()}>{t.create}</button>
        </footer>
      </section>}

      {activeChannelId && <section className="messenger-thread">
        <div className="messenger-messages">
          {messages.map((m, i) => {
            const mine = m.senderEmail === email;
            const read = mine && !!activeChannel && messageReadByOthers(m, activeChannel.members);
            const prev = messages[i - 1];
            const next = messages[i + 1];
            const sameDay = (a?: ChatMessage, b?: ChatMessage) =>
              !!a && !!b && new Date(a.createdAt).toDateString() === new Date(b.createdAt).toDateString();
            const joins = (a?: ChatMessage, b?: ChatMessage) => !!a && !!b && a.senderEmail === b.senderEmail && sameDay(a, b) &&
              Math.abs(new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()) < RUN_GAP_MS;
            const newDay = !prev || !sameDay(prev, m);
            const runStart = !joins(prev, m);
            const runEnd = !joins(m, next);
            const showSender = isGroupThread && !mine && runStart;
            const sender = activeChannel?.members.find(mm => mm.email === m.senderEmail);
            return <div key={m.id} className="messenger-message">
              {newDay && <div className="messenger-day"><span>{dayLabel(m.createdAt, t)}</span></div>}
              <div className={`messenger-bubble-line${mine ? ' is-mine' : ''}${runStart ? ' is-run-start' : ''}${runEnd ? ' is-run-end' : ''}`}>
                {isGroupThread && !mine && (runEnd
                  ? <Avatar small name={memberName(m.senderEmail)} email={m.senderEmail} online={!!sender?.online} />
                  : <span className="messenger-avatar-spacer" />)}
                <div className={`messenger-bubble-row ${mine ? 'is-mine' : ''}`}>
                  {showSender && <span className="messenger-sender" style={{ '--hue': senderHue(m.senderEmail) } as CSSProperties}>
                    {memberName(m.senderEmail)}
                  </span>}
                  {m.kind === 'sticker' && <p className="messenger-sticker">{m.body}</p>}
                  {m.kind === 'gif' && <figure className="messenger-gif">
                    <img src={m.mediaUrl ?? ''} alt={t.gifs} loading="lazy" />
                    {m.body && <figcaption>{m.body}</figcaption>}
                  </figure>}
                  {m.kind === 'file' && <a className="messenger-file" href={m.mediaUrl ?? '#'} target="_blank" rel="noreferrer" download={m.body} title={t.downloadFile}>
                    <span className="messenger-file-icon"><IconDocument size={18} /></span>
                    <span className="messenger-file-body">
                      <span className="messenger-file-name">{m.body}</span>
                      <span className="messenger-file-size">{formatFileSize(m.fileSize)}</span>
                    </span>
                    <IconDownload size={14} />
                  </a>}
                  {m.kind === 'text' && <p className="messenger-bubble-text">{m.body}</p>}
                  {runEnd && <span className="messenger-bubble-meta">
                    <span className="messenger-bubble-time">{clockLabel(m.createdAt, t.locale)}</span>
                    {mine && <span className={`messenger-receipt${read ? ' is-read' : ''}`} title={read ? t.readLabel : t.sentLabel}>
                      <IconCheck size={11} />{read && <IconCheck size={11} />}
                    </span>}
                  </span>}
                </div>
              </div>
            </div>;
          })}
          {!messages.length && <p className="messenger-empty">{t.noMessages}</p>}
          <div ref={messagesEndRef} />
        </div>

        {stickerPickerOpen && <div className="messenger-picker">
          <div className="messenger-sticker-grid">
            {STICKERS.map(s => <button key={s} type="button" onClick={() => void pickSticker(s)}>{s}</button>)}
          </div>
        </div>}
        {gifPickerOpen && <div className="messenger-picker">
          <div className="messenger-search messenger-gif-search">
            <IconSearch size={14} />
            <input value={gifQuery} onChange={e => setGifQuery(e.target.value)} placeholder={t.searchGifs} autoFocus />
          </div>
          {gifLoading && <p className="messenger-empty">{t.loading}</p>}
          {!gifLoading && gifResults && !gifResults.length && <p className="messenger-empty">{t.noGifs}</p>}
          {!gifLoading && gifResults && gifResults.length > 0 && <div className="messenger-gif-grid">
            {gifResults.map(g => <button key={g.id} type="button" onClick={() => void pickGif(g.url)}>
              <img src={g.previewUrl} alt={g.title} loading="lazy" />
            </button>)}
          </div>}
        </div>}

        <form className="messenger-compose" onSubmit={e => { e.preventDefault(); void submitMessage(); }}>
          <input ref={fileInputRef} type="file" className="messenger-file-input"
            onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void pickFile(f); }} />
          <button type="button" className="messenger-picker-toggle" aria-label={t.attachFile} disabled={fileSending}
            onClick={() => fileInputRef.current?.click()}><IconAttach size={16} /></button>
          <button type="button" className="messenger-picker-toggle" aria-pressed={stickerPickerOpen} aria-label={t.stickers}
            onClick={() => { setStickerPickerOpen(v => !v); setGifPickerOpen(false); }}>🙂</button>
          <button type="button" className="messenger-picker-toggle messenger-gif-toggle" aria-pressed={gifPickerOpen} aria-label={t.gifs}
            onClick={() => { setGifPickerOpen(v => !v); setStickerPickerOpen(false); if (!gifResults) setGifQuery(''); }}>GIF</button>
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={t.messagePlaceholder} />
          <button type="submit" aria-label={t.send} disabled={!draft.trim()}><IconSend size={16} /></button>
        </form>
      </section>}

      {error && <p role="alert" className="messenger-error">{t.error}</p>}
    </section>}
  </>;
}
