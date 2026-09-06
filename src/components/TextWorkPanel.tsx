import { useEffect, useRef, useState } from 'react';
import {
  IconArchive,
  IconArrowUp,
  IconAttach,
  IconClose,
  IconCopy,
  IconDownload,
  IconEdit,
  IconFolder,
  IconFolderPlus,
  IconImage,
  IconMore,
  IconNewChat,
  IconNews,
  IconRegenerate,
  IconSearch,
  IconShare,
  IconSidebar,
  IconThumb,
  IconTools,
  IconVideo,
} from './Icons';
import DropdownMenu, { type DropdownMenuItem } from './DropdownMenu';
import Logo from './Logo';
import {
  buildDocxDataUrl,
  buildPptxDataUrl,
  suggestedFileName,
  type ParsedDeliverable,
} from '../deliverables';
import { useT } from '../i18n';
import { useWorkspace } from '../copywrite/useWorkspace';
import {
  exportMarkdown,
  id,
  isAttachable,
  MAX_ATTACHMENTS,
  MAX_TEXT_LENGTH,
  newThread,
  readAttachment,
  removeThread,
  type Attachment,
  type Thread,
} from '../copywrite/workspace';

interface TextWorkPanelProps {
  active: boolean;
  storageScope: string;
  email?: string | null;
  subscriptionLabel?: string;
  onProfile: () => void;
  onSubscription: () => void;
  onGenerate: (kind: 'image' | 'video', prompt: string) => void;
}

type Modal =
  | { kind: 'search' | 'archive' | 'share' | 'unavailable' | 'model' }
  | {
      kind: 'project-new' | 'project-rename' | 'thread-rename' | 'delete-project' | 'delete-thread' | 'move';
      target?: string;
    };

export default function TextWorkPanel({
  active,
  storageScope,
  email,
  subscriptionLabel,
  onProfile,
  onSubscription,
  onGenerate,
}: TextWorkPanelProps) {
  const t = useT();
  const l = t.textWork;
  const { workspace: w, update, storageError, pending, errors, send, regenerate, invalidate } = useWorkspace(
    storageScope,
    l.newChat
  );
  const thread = w.threads.find((th) => th.id === w.activeId) ?? w.threads[0];
  const loading = Boolean(pending[thread.id]);
  const [modal, setModal] = useState<Modal | null>(null);
  const [modalValue, setModalValue] = useState('');
  const [search, setSearch] = useState('');
  const [expandedProjects, setExpandedProjects] = useState<string[]>([]);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openThreadMenu, setOpenThreadMenu] = useState<string | null>(null);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [openProjectMenu, setOpenProjectMenu] = useState<string | null>(null);
  const [toolsMenuOpen, setToolsMenuOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number>();
  const [editBackup, setEditBackup] = useState<{ draft: string; attachments: Attachment[] }>();
  const [notice, setNotice] = useState('');
  const [copied, setCopied] = useState<string>();
  const [downloading, setDownloading] = useState<string>();
  const [attaching, setAttaching] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const nearBottom = useRef(true);
  const noticeTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => () => clearTimeout(noticeTimer.current), []);

  useEffect(() => {
    setEditIndex(undefined);
    setEditBackup(undefined);
    setNotice('');
    setHeaderMenuOpen(false);
    nearBottom.current = true;
  }, [thread.id]);

  useEffect(() => {
    if (!active) {
      setModal(null);
      setMobileOpen(false);
    }
  }, [active]);

  useEffect(() => {
    if (!active || !nearBottom.current) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [active, thread.id, thread.messages.length, loading]);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [thread.draft, active]);

  useEffect(() => {
    if (!active) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearch('');
        setModal({ kind: 'search' });
      }
      if (e.key === 'Escape') {
        setMobileOpen(false);
        setModal(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active]);

  const patchThread = (threadId: string, patch: Partial<Thread>) => {
    update((s) => ({ ...s, threads: s.threads.map((th) => (th.id === threadId ? { ...th, ...patch } : th)) }));
  };

  const toast = (text: string) => {
    setNotice(text);
    clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(''), 6000);
  };

  const selectThread = (threadId: string) => {
    if (editIndex !== undefined && editBackup) patchThread(thread.id, editBackup);
    update((s) => ({ ...s, activeId: threadId }));
    setMobileOpen(false);
    setModal(null);
  };

  const addChat = (projectId?: string) => {
    if (editIndex !== undefined && editBackup) patchThread(thread.id, editBackup);
    const fresh = newThread(l.newChat, projectId);
    update((s) => ({ ...s, threads: [fresh, ...s.threads], activeId: fresh.id }));
    if (projectId) setExpandedProjects((p) => [...new Set([...p, projectId])]);
    setMobileOpen(false);
    setModal(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const openModal = (value: Modal, initial = '') => {
    setModalValue(initial);
    setSearch('');
    setModal(value);
  };

  const quickPrompt = (prompt: string) => {
    patchThread(thread.id, { draft: prompt });
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const copyText = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      toast(l.copiedLabel);
    } catch {
      toast(l.storageError);
    }
  };

  const saveText = async (text: string, name: string, mime: string) => {
    try {
      const blob = new Blob([text], { type: mime });
      const url = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
      await window.api.saveFile(url, name);
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    }
  };

  const handleDownload = async (deliverable: ParsedDeliverable, messageId: string) => {
    setDownloading(messageId);
    try {
      const data =
        deliverable.kind === 'document' ? await buildDocxDataUrl(deliverable) : await buildPptxDataUrl(deliverable);
      await window.api.saveFile(data, suggestedFileName(deliverable));
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err));
    } finally {
      setDownloading(undefined);
    }
  };

  const attachFiles = async (files: FileList | File[]) => {
    if (attaching || loading) return;
    const targetId = thread.id;
    const selected = [...files].filter(isAttachable);
    if (selected.length === 0) {
      if (files.length > 0) toast(l.fileError);
      return;
    }
    if (thread.attachments.length + selected.length > MAX_ATTACHMENTS) {
      toast(l.fileError);
      return;
    }
    setAttaching(true);
    try {
      const added = await Promise.all(selected.map(readAttachment));
      update((s) => ({
        ...s,
        threads: s.threads.map((th) =>
          th.id === targetId ? { ...th, attachments: [...th.attachments, ...added].slice(0, MAX_ATTACHMENTS) } : th
        ),
      }));
    } catch {
      toast(l.fileError);
    } finally {
      setAttaching(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = () => {
    if (thread.draft.trim().length > MAX_TEXT_LENGTH) {
      toast(l.promptLimit);
      return;
    }
    if (!thread.draft.trim() || loading || attaching) return;
    nearBottom.current = true;
    send(thread.id, undefined, editIndex);
    setEditIndex(undefined);
    setEditBackup(undefined);
  };

  const startEdit = (index: number) => {
    if (loading) return;
    setEditBackup({ draft: thread.draft, attachments: thread.attachments });
    setEditIndex(index);
    patchThread(thread.id, { draft: thread.messages[index].content, attachments: thread.messages[index].attachments ?? [] });
    inputRef.current?.focus();
  };

  const cancelEdit = () => {
    if (editBackup) patchThread(thread.id, editBackup);
    setEditIndex(undefined);
    setEditBackup(undefined);
  };

  const confirmModal = () => {
    if (!modal) return;
    const value = modalValue.trim();
    if (modal.kind === 'project-new' && value) {
      const projectId = id();
      update((s) => ({ ...s, projects: [...s.projects, { id: projectId, name: value }] }));
      setExpandedProjects((p) => [...p, projectId]);
    } else if (modal.kind === 'project-rename' && value) {
      update((s) => ({ ...s, projects: s.projects.map((p) => (p.id === modal.target ? { ...p, name: value } : p)) }));
    } else if (modal.kind === 'thread-rename' && value) {
      patchThread(modal.target!, { title: value });
    } else if (modal.kind === 'delete-thread') {
      invalidate(modal.target!);
      update((s) => removeThread(s, modal.target!, l.newChat));
    } else if (modal.kind === 'delete-project') {
      update((s) => ({
        ...s,
        projects: s.projects.filter((p) => p.id !== modal.target),
        threads: s.threads.map((th) => (th.projectId === modal.target ? { ...th, projectId: undefined } : th)),
      }));
    }
    setModal(null);
  };

  const threadMenuItems = (th: Thread): DropdownMenuItem[] => [
    { label: l.renameLabel, onClick: () => openModal({ kind: 'thread-rename', target: th.id }, th.title) },
    { label: th.pinned ? l.unpinLabel : l.pinLabel, onClick: () => patchThread(th.id, { pinned: !th.pinned }) },
    { label: l.moveToProject, onClick: () => openModal({ kind: 'move', target: th.id }) },
    {
      label: th.archived ? l.restoreLabel : l.archiveAction,
      onClick: () => {
        patchThread(th.id, { archived: !th.archived });
        if (!th.archived && th.id === w.activeId) addChat();
      },
    },
    { label: l.removeLabel, danger: true, onClick: () => openModal({ kind: 'delete-thread', target: th.id }) },
  ];

  const renderThread = (th: Thread) => (
    <div key={th.id} className={`cw-history-row ${th.id === thread.id ? 'cw-selected' : ''}`}>
      <button className="cw-history-link" onClick={() => selectThread(th.id)}>
        <span className="cw-history-title">{th.title}</span>
        {pending[th.id] && <span className="cw-history-thinking">…</span>}
      </button>
      <div className="cw-row-menu-wrap">
        <button
          className={`cw-row-menu ${openThreadMenu === th.id ? 'cw-row-menu-open' : ''}`}
          title={`${l.moreTooltip}: ${th.title}`}
          onClick={() => setOpenThreadMenu((cur) => (cur === th.id ? null : th.id))}
        >
          <IconMore size={14} />
        </button>
        {openThreadMenu === th.id && (
          <DropdownMenu align="right" items={threadMenuItems(th)} onClose={() => setOpenThreadMenu(null)} />
        )}
      </div>
    </div>
  );

  const history = w.threads.filter((th) => !th.archived && !th.projectId && (th.messages.length > 0 || th.id === thread.id));
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const startOfYesterday = new Date(startOfToday);
  startOfYesterday.setDate(startOfYesterday.getDate() - 1);
  const groups: [string, Thread[]][] = [
    [l.pinnedSection, history.filter((th) => th.pinned)],
    [l.todaySection, history.filter((th) => !th.pinned && th.updatedAt >= +startOfToday)],
    [l.yesterdaySection, history.filter((th) => !th.pinned && th.updatedAt >= +startOfYesterday && th.updatedAt < +startOfToday)],
    [l.earlierSection, history.filter((th) => !th.pinned && th.updatedAt < +startOfYesterday)],
  ];
  const visibleSearch = w.threads
    .filter((th) => modal?.kind !== 'archive' || th.archived)
    .filter(
      (th) =>
        !search.trim() ||
        `${th.title}\n${th.messages.map((m) => m.content).join('\n')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const empty = thread.messages.length === 0;
  const fileBaseName = thread.title.replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().slice(0, 64) || 'oneflow-chat';
  const emailName = email?.split('@')[0];
  const avatarInitial = (emailName || 'O')[0]?.toUpperCase() ?? 'O';

  return (
    <div
      className={`cw-panel ${active ? '' : 'cw-hidden'} ${w.sidebarCollapsed ? 'cw-collapsed' : ''} ${mobileOpen ? 'cw-mobile-open' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void attachFiles(e.dataTransfer.files);
      }}
    >
      {mobileOpen && <button className="cw-mobile-backdrop" onClick={() => setMobileOpen(false)} aria-label={l.closeLabel} />}
      <aside className="cw-sidebar">
        <div className="cw-sidebar-header">
          <button className="cw-brand" onClick={() => addChat()}>
            <Logo className="cw-logo" />
          </button>
          <button
            className="cw-icon-btn"
            title={w.sidebarCollapsed ? l.expandSidebarTooltip : l.collapseSidebarTooltip}
            onClick={() => {
              if (mobileOpen) setMobileOpen(false);
              else update((s) => ({ ...s, sidebarCollapsed: !s.sidebarCollapsed }));
            }}
          >
            <IconSidebar size={16} />
          </button>
        </div>
        <div className="cw-main-links">
          <button className="cw-nav-button" onClick={() => addChat()}>
            <IconNewChat size={16} /> <span>{l.newChat}</span>
          </button>
          <button className="cw-nav-button" onClick={() => openModal({ kind: 'search' })} title="Ctrl / ⌘ K">
            <IconSearch size={16} /> <span>{l.search}</span>
          </button>
        </div>
        <div className="cw-sidebar-scroll">
          <div className="cw-projects-heading">
            <span>{l.projects}</span>
            <button className="cw-icon-btn" title={l.createProjectTitle} onClick={() => openModal({ kind: 'project-new' })}>
              <IconFolderPlus size={14} />
            </button>
          </div>
          {w.projects.map((p) => {
            const projectThreads = w.threads.filter((th) => th.projectId === p.id && !th.archived);
            return (
              <div key={p.id}>
                <div className="cw-history-row">
                  <button
                    className="cw-history-link"
                    aria-expanded={expandedProjects.includes(p.id)}
                    onClick={() => setExpandedProjects((s) => (s.includes(p.id) ? s.filter((x) => x !== p.id) : [...s, p.id]))}
                  >
                    <IconFolder size={14} />
                    <span className="cw-history-title">{p.name}</span>
                    <span className="cw-count">{String(projectThreads.length).padStart(2, '0')}</span>
                  </button>
                  <div className="cw-row-menu-wrap">
                    <button
                      className={`cw-row-menu ${openProjectMenu === p.id ? 'cw-row-menu-open' : ''}`}
                      title={`${l.projects}: ${p.name}`}
                      onClick={() => setOpenProjectMenu((cur) => (cur === p.id ? null : p.id))}
                    >
                      <IconMore size={14} />
                    </button>
                    {openProjectMenu === p.id && (
                      <DropdownMenu
                        align="right"
                        onClose={() => setOpenProjectMenu(null)}
                        items={[
                          { label: l.newChat, onClick: () => addChat(p.id) },
                          { label: l.renameLabel, onClick: () => openModal({ kind: 'project-rename', target: p.id }, p.name) },
                          { label: l.removeLabel, danger: true, onClick: () => openModal({ kind: 'delete-project', target: p.id }) },
                        ]}
                      />
                    )}
                  </div>
                </div>
                {expandedProjects.includes(p.id) && (
                  <div className="cw-project-chats">
                    {projectThreads.length === 0 ? (
                      <div className="cw-empty-project">{l.emptyProject}</div>
                    ) : (
                      projectThreads.map(renderThread)
                    )}
                    <button className="cw-nav-button cw-project-new-chat" onClick={() => addChat(p.id)}>
                      <IconNewChat size={14} /> <span>{l.newChat}</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          {groups.map(
            ([label, threads]) =>
              threads.length > 0 && (
                <div key={label} className="cw-history-group">
                  <div className="cw-group-label">{label}</div>
                  {[...threads].sort((a, b) => b.updatedAt - a.updatedAt).map(renderThread)}
                </div>
              )
          )}
          <button className="cw-archive-btn" onClick={() => openModal({ kind: 'archive' })}>
            <IconArchive size={14} /> <span>{l.archiveSection}</span>
          </button>
        </div>
        <div className="cw-profile">
          <button className="cw-avatar-mini" onClick={onProfile} title={l.profileLabel}>
            {avatarInitial}
          </button>
          <button className="cw-profile-name" onClick={onProfile}>
            <span className="cw-profile-email">{emailName || 'ONEFLOW'}</span>
            <span className="cw-profile-plan-hint">{subscriptionLabel || 'ONEFLOW'}</span>
          </button>
          <button className="cw-plan" onClick={onSubscription}>
            {l.planLabel}
          </button>
        </div>
      </aside>

      <div className="cw-stage">
        <div className={`cw-surface ${empty ? 'cw-empty' : ''}`}>
          <div className="cw-chat-header">
            <button className="cw-mobile-toggle cw-icon-btn" onClick={() => setMobileOpen(true)} title={l.expandSidebarTooltip}>
              <IconSidebar size={16} />
            </button>
            <span className="cw-chat-title">{!empty ? thread.title : ''}</span>
            {!empty && (
              <div className="cw-chat-header-actions">
                <div className="cw-row-menu-wrap">
                  <button className="cw-icon-btn" title={l.moreTooltip} onClick={() => setHeaderMenuOpen((v) => !v)}>
                    <IconMore size={16} />
                  </button>
                  {headerMenuOpen && (
                    <DropdownMenu align="right" items={threadMenuItems(thread)} onClose={() => setHeaderMenuOpen(false)} />
                  )}
                </div>
                <button className="cw-share-btn" onClick={() => openModal({ kind: 'share' })}>
                  <IconShare size={14} /> {l.shareTooltip}
                </button>
              </div>
            )}
          </div>

          {!empty && (
            <div
              className="cw-log"
              ref={listRef}
              onScroll={() => {
                const el = listRef.current;
                if (el) nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
              }}
            >
              <div className="cw-message-column">
                {thread.messages.map((m, index) => (
                  <div key={m.id} className={`cw-message cw-message-${m.role}`}>
                    {m.role === 'assistant' && <div className="cw-assistant-label">ONEFLOW AI</div>}
                    {!!m.attachments?.length && (
                      <div className="cw-message-attachments">
                        {m.attachments.map((a) => (
                          <div key={a.id} className="cw-message-attachment">
                            {a.kind === 'image' ? (
                              <img className="cw-message-image" src={a.data} alt={a.name} />
                            ) : (
                              <span className="cw-message-doc-chip">{a.name}</span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                    {m.role === 'user' ? (
                      <div className="cw-user-bubble">{m.content}</div>
                    ) : (
                      <div className="cw-assistant-text">{m.content}</div>
                    )}
                    {m.deliverable && (
                      <button
                        className="chat-deliverable-btn"
                        disabled={downloading === m.id}
                        onClick={() => void handleDownload(m.deliverable!, m.id)}
                      >
                        <IconDownload size={13} />
                        {downloading === m.id
                          ? l.preparingFile
                          : `${l.downloadDoc.split(' ')[0]} · ${m.deliverable.kind === 'document' ? 'DOCX' : 'PPTX'}`}
                      </button>
                    )}
                    <div className="cw-message-actions">
                      <button
                        className="cw-action-btn"
                        title={copied === m.id ? l.copiedLabel : l.copyTooltip}
                        onClick={() => void copyText(m.content, m.id)}
                      >
                        <IconCopy size={13} />
                      </button>
                      {m.role === 'user' ? (
                        <button className="cw-action-btn" title={l.editTooltip} disabled={loading} onClick={() => startEdit(index)}>
                          <IconEdit size={13} />
                        </button>
                      ) : (
                        <>
                          <button
                            className="cw-action-btn"
                            title={l.regenerateTooltip}
                            disabled={loading}
                            onClick={() => regenerate(thread.id, index)}
                          >
                            <IconRegenerate size={13} />
                          </button>
                          <button
                            className={`cw-action-btn ${m.feedback === 'up' ? 'active' : ''}`}
                            title={l.goodResponseTooltip}
                            onClick={() =>
                              patchThread(thread.id, {
                                messages: thread.messages.map((x) => (x.id === m.id ? { ...x, feedback: x.feedback === 'up' ? undefined : 'up' } : x)),
                              })
                            }
                          >
                            <IconThumb size={13} />
                          </button>
                          <button
                            className={`cw-action-btn ${m.feedback === 'down' ? 'active' : ''}`}
                            title={l.badResponseTooltip}
                            onClick={() =>
                              patchThread(thread.id, {
                                messages: thread.messages.map((x) => (x.id === m.id ? { ...x, feedback: x.feedback === 'down' ? undefined : 'down' } : x)),
                              })
                            }
                          >
                            <IconThumb size={13} down />
                          </button>
                          <button
                            className="cw-action-btn"
                            title={l.exportAnswerMd}
                            onClick={() => void saveText(m.content, 'oneflow-answer.md', 'text/markdown;charset=utf-8')}
                          >
                            <IconDownload size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {loading && <div className="cw-thinking">{l.loadingLabel}</div>}
              </div>
            </div>
          )}

          <div className={empty ? 'cw-welcome' : 'cw-composer-zone'}>
            {empty && (
              <div className="cw-greeting">
                <h1 className="cw-greeting-title">{l.greeting}</h1>
                <p className="cw-subtitle">{l.subtitle}</p>
              </div>
            )}
            <div className="cw-composer-container">
              {storageError && (
                <div className="cw-storage-error" role="alert">
                  <span>{storageError === 'load' ? l.loadError : l.storageError}</span>
                  <button
                    className="secondary-btn"
                    onClick={() => void saveText(JSON.stringify(w, null, 2), 'oneflow-chat-backup.json', 'application/json')}
                  >
                    {l.exportJson}
                  </button>
                </div>
              )}
              {!loading && !errors[thread.id] && thread.messages[thread.messages.length - 1]?.role === 'user' && (
                <button className="secondary-btn cw-retry-btn" onClick={() => regenerate(thread.id)}>
                  {l.retryLabel}
                </button>
              )}
              {errors[thread.id] && (
                <div className="error-text cw-error-row" role="alert">
                  <span>{errors[thread.id]}</span>
                  <button className="secondary-btn" disabled={loading} onClick={() => regenerate(thread.id)}>
                    {l.retryLabel}
                  </button>
                </div>
              )}
              {notice && (
                <div className="cw-notice" role="status">
                  {notice}
                </div>
              )}
              {!loading && editIndex === undefined && thread.suggestions.length > 0 && (
                <div className="chat-suggestions">
                  {thread.suggestions.map((s, i) => (
                    <button key={i} className="chat-suggestion-chip" onClick={() => send(thread.id, s)}>
                      {s}
                    </button>
                  ))}
                </div>
              )}
              {editIndex !== undefined && (
                <div className="cw-edit-hint">
                  <span>{l.editHelp}</span>
                  <button className="secondary-btn" onClick={cancelEdit}>
                    {l.cancelLabel}
                  </button>
                </div>
              )}

              <div className="text-work-quickprompts">
                <span className="text-work-quickprompts-label">{t.textWork.quickPromptsLabel}</span>
                <div className="text-work-quickprompts-list">
                  {t.textWork.quickPrompts.map((qp, i) => (
                    <button key={i} type="button" className="text-work-quickprompt-chip" onClick={() => quickPrompt(qp.prompt)}>
                      {qp.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="cw-composer">
                {thread.attachments.length > 0 && (
                  <div className="cw-attachments">
                    {thread.attachments.map((a) => (
                      <div key={a.id} className="cw-attachment">
                        {a.kind === 'image' ? <img src={a.data} alt="" className="cw-thumb" /> : <IconNews size={14} />}
                        <span className="cw-attachment-name">{a.name}</span>
                        <button
                          className="cw-attachment-remove"
                          title={`${l.removeLabel}: ${a.name}`}
                          onClick={() => patchThread(thread.id, { attachments: thread.attachments.filter((x) => x.id !== a.id) })}
                        >
                          <IconClose size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <textarea
                  ref={inputRef}
                  className="cw-input"
                  rows={2}
                  value={thread.draft}
                  placeholder={l.inputPlaceholder}
                  onChange={(e) => patchThread(thread.id, { draft: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  onPaste={(e) => {
                    if (e.clipboardData.files.length > 0) {
                      e.preventDefault();
                      void attachFiles(e.clipboardData.files);
                    }
                  }}
                />
                <div className="cw-composer-footer">
                  <div className="cw-composer-footer-left">
                    <button
                      className="cw-icon-btn"
                      title={l.attachTooltip}
                      disabled={loading || attaching}
                      onClick={() => fileRef.current?.click()}
                    >
                      <IconAttach size={16} />
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      hidden
                      multiple
                      accept="image/png,image/jpeg,image/webp,.txt,.md,.csv,.json"
                      onChange={(e) => {
                        if (e.target.files) void attachFiles(e.target.files);
                      }}
                    />
                    <div className="cw-row-menu-wrap cw-tools-menu-wrap">
                      <button className="cw-icon-btn" title={l.toolsTooltip} onClick={() => setToolsMenuOpen((v) => !v)}>
                        <IconTools size={16} />
                      </button>
                      {toolsMenuOpen && (
                        <DropdownMenu
                          align="left"
                          onClose={() => setToolsMenuOpen(false)}
                          items={[
                            { label: l.writeQuick, onClick: () => quickPrompt(l.writePrompt) },
                            { label: l.academicLabel, onClick: () => quickPrompt(l.researchPrompt) },
                            { label: l.developerLabel, onClick: () => quickPrompt(l.codePrompt) },
                            { label: l.deepSearchLabel, onClick: () => openModal({ kind: 'unavailable' }) },
                          ]}
                        />
                      )}
                    </div>
                  </div>
                  <div className="cw-composer-footer-right">
                    <button className="cw-model-btn" onClick={() => openModal({ kind: 'model' })}>
                      ONEFLOW AI
                    </button>
                    <button
                      className="cw-send"
                      title={l.sendTooltip}
                      disabled={loading || attaching || !thread.draft.trim()}
                      onClick={submit}
                    >
                      <IconArrowUp size={16} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            {empty && (
              <div className="cw-quick-actions">
                <button className="cw-quick-action" onClick={() => quickPrompt(l.writePrompt)}>
                  <IconNewChat size={14} /> {l.writeQuick}
                </button>
                <button className="cw-quick-action" onClick={() => onGenerate('image', thread.draft)}>
                  <IconImage size={14} /> {l.imagesQuick}
                </button>
                <button className="cw-quick-action" onClick={() => openModal({ kind: 'unavailable' })}>
                  <IconNews size={14} /> {l.newsQuick}
                </button>
                <button className="cw-quick-action" onClick={() => onGenerate('video', thread.draft)}>
                  <IconVideo size={14} /> {l.videoQuick}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {modal && (
        <div className="modal-overlay" onClick={() => setModal(null)}>
          <div className="modal cw-modal" onClick={(e) => e.stopPropagation()}>
            <button className="admin-panel-close" onClick={() => setModal(null)}>
              <IconClose size={16} />
            </button>
            <h2>
              {modal.kind === 'search'
                ? l.search
                : modal.kind === 'archive'
                  ? l.archiveSection
                  : modal.kind === 'share'
                    ? l.shareTooltip
                    : modal.kind === 'project-new'
                      ? l.createProjectTitle
                      : modal.kind === 'delete-project'
                        ? l.deleteProjectTitle
                        : modal.kind === 'delete-thread'
                          ? l.deleteChatTitle
                          : modal.kind === 'move'
                            ? l.moveToProject
                            : modal.kind === 'model'
                              ? 'ONEFLOW AI'
                              : modal.kind === 'unavailable'
                                ? l.deepSearchLabel
                                : l.renameLabel}
            </h2>

            {modal.kind === 'search' || modal.kind === 'archive' ? (
              <>
                <input
                  className="node-select"
                  autoFocus
                  placeholder={l.searchPlaceholder}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="cw-search-results">
                  {visibleSearch.length > 0 ? (
                    visibleSearch.map((th) => (
                      <div key={th.id} className="cw-search-result-row">
                        <button className="cw-search-result" onClick={() => selectThread(th.id)}>
                          <span className="cw-history-title">{th.title}</span>
                          <span className="cw-search-result-preview">
                            {th.messages[th.messages.length - 1]?.content || l.newChat}
                          </span>
                        </button>
                        {th.archived && (
                          <button className="secondary-btn" onClick={() => patchThread(th.id, { archived: false })}>
                            {l.restoreLabel}
                          </button>
                        )}
                      </div>
                    ))
                  ) : (
                    <div className="connected-hint">{l.noResults}</div>
                  )}
                </div>
                <p className="modal-hint">{l.localHistory}</p>
              </>
            ) : modal.kind === 'share' ? (
              <>
                <p className="modal-hint">{l.shareHelp}</p>
                <button className="secondary-btn" onClick={() => void copyText(exportMarkdown(thread), 'thread')}>
                  <IconCopy size={13} /> {l.copyTooltip}
                </button>
                <button
                  className="secondary-btn"
                  onClick={() => void saveText(exportMarkdown(thread), `${fileBaseName}.md`, 'text/markdown;charset=utf-8')}
                >
                  <IconDownload size={13} /> {l.exportMd}
                </button>
              </>
            ) : modal.kind === 'move' ? (
              <div className="cw-move-list">
                {[{ id: '', name: l.noProject }, ...w.projects].map((p) => (
                  <button
                    key={p.id}
                    className="secondary-btn"
                    onClick={() => {
                      patchThread(modal.target!, { projectId: p.id || undefined });
                      if (p.id) setExpandedProjects((s) => [...new Set([...s, p.id])]);
                      setModal(null);
                    }}
                  >
                    <IconFolder size={13} /> {p.name}
                  </button>
                ))}
              </div>
            ) : modal.kind === 'unavailable' || modal.kind === 'model' ? (
              <p className="modal-hint">{modal.kind === 'model' ? l.modelHelp : l.unavailableWebSearch}</p>
            ) : (
              <>
                {modal.kind.startsWith('delete-') ? (
                  <p className="modal-hint">{modal.kind === 'delete-project' ? l.deleteProjectHelp : l.deleteChatHelp}</p>
                ) : (
                  <input
                    className="node-select"
                    autoFocus
                    value={modalValue}
                    onChange={(e) => setModalValue(e.target.value)}
                    placeholder={modal.kind === 'project-new' ? l.projectNamePlaceholder : l.namePlaceholder}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && modalValue.trim()) confirmModal();
                    }}
                  />
                )}
                <div className="modal-actions">
                  <button className="secondary-btn" onClick={() => setModal(null)}>
                    {l.cancelLabel}
                  </button>
                  <button
                    className={modal.kind.startsWith('delete-') ? 'generate-btn cw-danger-btn' : 'generate-btn'}
                    disabled={!modal.kind.startsWith('delete-') && !modalValue.trim()}
                    onClick={confirmModal}
                  >
                    {modal.kind.startsWith('delete-') ? l.removeLabel : modal.kind === 'project-new' ? l.createLabel : l.saveLabel}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
