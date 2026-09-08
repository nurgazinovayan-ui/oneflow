import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { IconChat, IconClose, IconSend, IconPlus, IconSearch, IconChevronRight } from './Icons';
import {
  heartbeat, getRoster, listChannels, startDm, createGroup, listMessages, sendMessage,
  type RosterEntry, type ChannelSummary, type ChatMessage, type MessengerStatus,
} from '../messenger/client';

const HEARTBEAT_MS = 20_000;
const POLL_MS = 4_000;
const BACKGROUND_POLL_MS = 15_000; // keeps the unread badge live while the widget is closed or on another tab
const READ_KEY_PREFIX = 'oneflow-messenger-read:';
const AVATAR_COLORS = ['#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899', '#ef4444'];

type View = 'chats' | 'people' | 'newGroup';
type Translations = ReturnType<typeof useT>['messenger'];

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

function channelLabel(channel: ChannelSummary, myEmail: string): string {
  if (channel.kind === 'group') return channel.title;
  const other = channel.members.find(m => m.email !== myEmail);
  return other?.displayName ?? channel.title;
}

function avatarColor(email: string): string {
  let hash = 0;
  for (let i = 0; i < email.length; i++) hash = (hash * 31 + email.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
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

function Avatar({ name, email, online }: { name: string; email: string; online: boolean }) {
  const letter = (name || email).trim().charAt(0).toUpperCase();
  return <span className={`messenger-avatar ${online ? 'is-online' : 'is-offline'}`} style={{ background: avatarColor(email) }}>
    {letter}<span className="messenger-avatar-dot" />
  </span>;
}

export default function MessengerWidget({ email, activity }: { email: string; activity: MessengerStatus }) {
  const t = useT().messenger;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('people');
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
  const activeChannelRef = useRef<string | null>(null);
  const activityRef = useRef(activity);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  activeChannelRef.current = activeChannelId;
  activityRef.current = activity;

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

  // Keeps the unread badge accurate while the panel is closed, or open on a tab other than
  // Chats — the fast poll below already refreshes channels every 4s in that one case, so this
  // steps aside instead of doubling up.
  useEffect(() => {
    if (open && view === 'chats') return;
    let cancelled = false;
    const poll = () => { void listChannels().then(list => { if (!cancelled) setChannels(list); }).catch(() => {}); };
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
          const last = messages.length ? messages[messages.length - 1].createdAt : undefined;
          const fresh = await listMessages(activeChannelRef.current, last);
          if (!cancelled && fresh.length) {
            setMessages(prev => [...prev, ...fresh]);
            markRead(activeChannelRef.current, fresh[fresh.length - 1].createdAt);
          }
        } else if (view === 'chats') {
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

  const openThread = async (channelId: string) => {
    setActiveChannelId(channelId);
    setMessages([]);
    setError(false);
    markRead(channelId, new Date().toISOString());
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
      setView('chats');
      await openThread(id);
    } catch { setError(true); } finally { setBusy(false); }
  };

  const submitGroup = async () => {
    if (!groupTitle.trim() || groupMembers.length === 0) return;
    setBusy(true); setError(false);
    try {
      const { id } = await createGroup(groupTitle.trim(), groupMembers);
      setGroupTitle(''); setGroupMembers([]); setView('chats');
      await openThread(id);
    } catch { setError(true); } finally { setBusy(false); }
  };

  const submitMessage = async () => {
    const text = draft.trim();
    if (!text || !activeChannelId) return;
    setDraft('');
    try {
      const created = await sendMessage(activeChannelId, text);
      setMessages(prev => [...prev, created]);
      markRead(activeChannelId, created.createdAt);
    } catch { setError(true); setDraft(text); }
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
    p.displayName.toLowerCase().includes(peopleQuery.toLowerCase()));
  const unreadChannelIds = new Set(
    (channels ?? [])
      .filter(c => c.lastMessage && c.lastMessage.senderEmail !== email &&
        (!readMap[c.id] || c.lastMessage.createdAt > readMap[c.id]))
      .map(c => c.id)
  );
  const unreadCount = unreadChannelIds.size;
  const unreadLabel = unreadCount > 9 ? '9+' : `+${unreadCount}`;

  return <>
    <button className="messenger-bubble" aria-label={t.bubbleLabel} onClick={() => setOpen(v => !v)}>
      {open ? <IconClose size={20} /> : <IconChat size={20} />}
      {!open && unreadCount > 0 && <span className="messenger-badge">{unreadLabel}</span>}
    </button>
    {open && <section className="messenger-panel" aria-label={t.title}>
      <header className="messenger-header">
        {activeChannelId
          ? <><button className="messenger-back" onClick={backToList} aria-label={t.back}><IconChevronRight size={14} /></button>
              <div className="messenger-header-title">
                <h2>{activeChannel ? channelLabel(activeChannel, email) : ''}</h2>
                {activeOther && <span className="messenger-header-status">{activeOther.online ? statusLabel(t, activeOther.status) : t.offline}</span>}
              </div></>
          : <h2>{t.title}</h2>}
        <button className="messenger-close" onClick={() => setOpen(false)} aria-label={t.close}><IconClose size={16} /></button>
      </header>

      {!activeChannelId && <nav className="messenger-tabs">
        <button aria-pressed={view === 'chats'} onClick={() => setView('chats')}>
          {t.tabChats}{unreadCount > 0 && <span className="messenger-tab-badge">{unreadLabel}</span>}
        </button>
        <button aria-pressed={view === 'people'} onClick={() => setView('people')}>{t.tabPeople}</button>
      </nav>}

      {!activeChannelId && view === 'chats' && <section className="messenger-list">
        {!channels?.length && <p className="messenger-empty">{t.noChannels}</p>}
        {channels?.map(c => {
          const other = c.kind === 'dm' ? c.members.find(m => m.email !== email) : null;
          const unread = unreadChannelIds.has(c.id);
          return <button key={c.id} className={`messenger-row ${unread ? 'is-unread' : ''}`} onClick={() => void openThread(c.id)}>
            {c.kind === 'dm' && other && <Avatar name={other.displayName} email={other.email} online={other.online} />}
            <span className="messenger-row-body">
              <span className="messenger-row-title">{channelLabel(c, email)}</span>
              <span className="messenger-row-preview">
                {c.lastMessage ? `${c.lastMessage.senderEmail === email ? t.you + ': ' : ''}${c.lastMessage.body}` : ''}
              </span>
            </span>
            {unread && <span className="messenger-row-dot" />}
          </button>;
        })}
      </section>}

      {!activeChannelId && view === 'people' && <section className="messenger-list">
        <div className="messenger-search"><IconSearch size={14} /><input value={peopleQuery} onChange={e => setPeopleQuery(e.target.value)} placeholder={t.searchPeople} /></div>
        {editingName
          ? <div className="messenger-name-edit">
              <input value={nameDraft} onChange={e => setNameDraft(e.target.value)} placeholder={t.displayNamePrompt} autoFocus
                onKeyDown={e => e.key === 'Enter' && void saveName()} />
              <button onClick={() => void saveName()}>{t.save}</button>
            </div>
          : <button className="messenger-link" onClick={() => { setNameDraft(''); setEditingName(true); }}>{t.displayNamePrompt}</button>}
        {roster && !filteredRoster.length && <p className="messenger-empty">{t.noPeople}</p>}
        {filteredRoster.map(p => <button key={p.email} className="messenger-row" disabled={busy} onClick={() => void openDm(p.email)}>
          <Avatar name={p.displayName} email={p.email} online={p.online} />
          <span className="messenger-row-body">
            <span className="messenger-row-title">{p.displayName}</span>
            <span className="messenger-row-preview">{p.online ? statusLabel(t, p.status) : t.offline}</span>
          </span>
        </button>)}
        <button className="messenger-new-group" onClick={() => setView('newGroup')}><IconPlus size={14} />{t.newGroup}</button>
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
          <button onClick={() => { setView('people'); setGroupTitle(''); setGroupMembers([]); }}>{t.cancel}</button>
          <button className="messenger-primary" disabled={busy || !groupTitle.trim() || !groupMembers.length} onClick={() => void submitGroup()}>{t.create}</button>
        </footer>
      </section>}

      {activeChannelId && <section className="messenger-thread">
        <div className="messenger-messages">
          {messages.map(m => <div key={m.id} className={`messenger-bubble-row ${m.senderEmail === email ? 'is-mine' : ''}`}>
            <p className="messenger-bubble-text">{m.body}</p>
            <span className="messenger-bubble-time">{timeLabel(m.createdAt)}</span>
          </div>)}
          {!messages.length && <p className="messenger-empty">{t.noMessages}</p>}
          <div ref={messagesEndRef} />
        </div>
        <form className="messenger-compose" onSubmit={e => { e.preventDefault(); void submitMessage(); }}>
          <input value={draft} onChange={e => setDraft(e.target.value)} placeholder={t.messagePlaceholder} />
          <button type="submit" aria-label={t.send} disabled={!draft.trim()}><IconSend size={16} /></button>
        </form>
      </section>}

      {error && <p role="alert" className="messenger-error">{t.error}</p>}
    </section>}
  </>;
}
