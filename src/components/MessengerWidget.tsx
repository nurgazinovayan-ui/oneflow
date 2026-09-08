import { useEffect, useRef, useState } from 'react';
import { useT } from '../i18n';
import { IconChat, IconClose, IconSend, IconPlus, IconSearch, IconChevronRight } from './Icons';
import {
  heartbeat, getRoster, listChannels, startDm, createGroup, listMessages, sendMessage,
  type RosterEntry, type ChannelSummary, type ChatMessage,
} from '../messenger/client';

const HEARTBEAT_MS = 20_000;
const POLL_MS = 4_000;

type View = 'chats' | 'people' | 'newGroup';

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

export default function MessengerWidget({ email }: { email: string }) {
  const t = useT().messenger;
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<View>('chats');
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
  const activeChannelRef = useRef<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  activeChannelRef.current = activeChannelId;

  useEffect(() => {
    void heartbeat();
    const id = window.setInterval(() => void heartbeat(), HEARTBEAT_MS);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        if (activeChannelRef.current) {
          const last = messages.length ? messages[messages.length - 1].createdAt : undefined;
          const fresh = await listMessages(activeChannelRef.current, last);
          if (!cancelled && fresh.length) setMessages(prev => [...prev, ...fresh]);
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
    try { setMessages(await listMessages(channelId)); }
    catch { setError(true); }
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
    } catch { setError(true); setDraft(text); }
  };

  const saveName = async () => {
    const name = nameDraft.trim();
    if (!name) { setEditingName(false); return; }
    setEditingName(false);
    try { await heartbeat(name); } catch { /* next heartbeat retries */ }
  };

  const activeChannel = channels?.find(c => c.id === activeChannelId) ?? null;
  const filteredRoster = (roster ?? []).filter(p => !p.isSelf &&
    p.displayName.toLowerCase().includes(peopleQuery.toLowerCase()));

  return <>
    <button className="messenger-bubble" aria-label={t.bubbleLabel} onClick={() => setOpen(v => !v)}>
      {open ? <IconClose size={20} /> : <IconChat size={20} />}
    </button>
    {open && <section className="messenger-panel" aria-label={t.title}>
      <header className="messenger-header">
        {activeChannelId
          ? <><button className="messenger-back" onClick={backToList} aria-label={t.back}><IconChevronRight size={14} /></button>
              <h2>{activeChannel ? channelLabel(activeChannel, email) : ''}</h2></>
          : <h2>{t.title}</h2>}
        <button className="messenger-close" onClick={() => setOpen(false)} aria-label={t.close}><IconClose size={16} /></button>
      </header>

      {!activeChannelId && <nav className="messenger-tabs">
        <button aria-pressed={view === 'chats'} onClick={() => setView('chats')}>{t.tabChats}</button>
        <button aria-pressed={view === 'people'} onClick={() => setView('people')}>{t.tabPeople}</button>
      </nav>}

      {!activeChannelId && view === 'chats' && <section className="messenger-list">
        {!channels?.length && <p className="messenger-empty">{t.noChannels}</p>}
        {channels?.map(c => <button key={c.id} className="messenger-row" onClick={() => void openThread(c.id)}>
          <span className="messenger-row-title">
            {c.kind === 'dm' && <span className={`messenger-dot ${c.members.find(m => m.email !== email)?.online ? 'is-online' : ''}`} />}
            {channelLabel(c, email)}
          </span>
          <span className="messenger-row-preview">
            {c.lastMessage ? `${c.lastMessage.senderEmail === email ? t.you + ': ' : ''}${c.lastMessage.body}` : ''}
          </span>
        </button>)}
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
          <span className="messenger-row-title"><span className={`messenger-dot ${p.online ? 'is-online' : ''}`} />{p.displayName}</span>
          <span className="messenger-row-preview">{p.online ? t.online : t.offline}</span>
        </button>)}
        <button className="messenger-new-group" onClick={() => setView('newGroup')}><IconPlus size={14} />{t.newGroup}</button>
      </section>}

      {!activeChannelId && view === 'newGroup' && <section className="messenger-list">
        <input className="messenger-group-title" value={groupTitle} onChange={e => setGroupTitle(e.target.value)} placeholder={t.groupTitlePlaceholder} />
        <p className="messenger-meta">{t.selectMembers} · {t.membersCount(groupMembers.length)}</p>
        {(roster ?? []).filter(p => !p.isSelf).map(p => <label key={p.email} className="messenger-checkbox-row">
          <input type="checkbox" checked={groupMembers.includes(p.email)}
            onChange={e => setGroupMembers(prev => e.target.checked ? [...prev, p.email] : prev.filter(v => v !== p.email))} />
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
