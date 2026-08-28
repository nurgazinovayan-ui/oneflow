import { useEffect, useRef, useState } from 'react';
import { IconClose, IconCopy, IconDownload, IconNotePlus, IconSend } from './Icons';
import type { ChatMessage } from '../types';
import { parseSuggestions } from '../chatSuggestions';
import {
  buildDocxDataUrl,
  buildPptxDataUrl,
  parseDeliverable,
  suggestedFileName,
  type ParsedDeliverable,
} from '../deliverables';
import { formatGenerationError } from '../errorMessages';
import { useT } from '../i18n';

interface TextMessage extends ChatMessage {
  deliverable?: ParsedDeliverable;
}

interface TextThread {
  id: string;
  title: string;
  messages: TextMessage[];
  suggestions: string[] | null;
}

interface TextWorkPanelProps {
  active: boolean;
}

let threadIdCounter = 0;
const nextThreadId = () => `thread-${++threadIdCounter}-${Date.now().toString(36)}`;

function makeThread(title: string): TextThread {
  return { id: nextThreadId(), title, messages: [], suggestions: null };
}

export default function TextWorkPanel({ active }: TextWorkPanelProps) {
  const t = useT();
  const [threads, setThreads] = useState<TextThread[]>(() => [makeThread(t.textWork.dialogName(1))]);
  const [activeThreadId, setActiveThreadId] = useState(() => threads[0].id);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null);
  const [downloadingIndex, setDownloadingIndex] = useState<number | null>(null);
  const [downloadError, setDownloadError] = useState<{ index: number; message: string } | null>(
    null
  );
  const listRef = useRef<HTMLDivElement>(null);

  const activeThread = threads.find((t) => t.id === activeThreadId) ?? threads[0];

  useEffect(() => {
    if (!active) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeThread.messages.length, status, active]);

  const updateThread = (id: string, patch: Partial<TextThread>) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  };

  const renameThread = (id: string, title: string) => {
    setThreads((prev) => prev.map((t) => (t.id === id ? { ...t, title } : t)));
  };

  const addThread = () => {
    const thread = makeThread(t.textWork.dialogName(threads.length + 1));
    setThreads((prev) => [...prev, thread]);
    setActiveThreadId(thread.id);
    setDraft('');
    setStatus('idle');
    setError(undefined);
  };

  const deleteThread = (id: string) => {
    setThreads((prev) => {
      const remaining = prev.filter((t) => t.id !== id);
      if (remaining.length === 0) {
        const fresh = makeThread(t.textWork.dialogName(1));
        setActiveThreadId(fresh.id);
        return [fresh];
      }
      if (id === activeThreadId) {
        setActiveThreadId(remaining[remaining.length - 1].id);
      }
      return remaining;
    });
  };

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if (!text || status === 'loading') return;

    const isFirstMessage = activeThread.messages.length === 0;
    const threadId = activeThread.id;
    const nextMessages: TextMessage[] = [...activeThread.messages, { role: 'user', content: text }];
    updateThread(threadId, { messages: nextMessages, suggestions: null });
    if (isFirstMessage) {
      renameThread(threadId, text.length > 40 ? `${text.slice(0, 40)}…` : text);
    }
    setDraft('');
    setStatus('loading');
    setError(undefined);
    try {
      const reply = await window.api.generateChat(nextMessages, undefined, 'text');
      const { cleanedText: afterSuggestions, suggestions } = parseSuggestions(reply);
      const { cleanedText, deliverable } = parseDeliverable(afterSuggestions);
      const assistantMessage: TextMessage = {
        role: 'assistant',
        content: cleanedText || reply,
        deliverable: deliverable ?? undefined,
      };
      updateThread(threadId, {
        messages: [...nextMessages, assistantMessage],
        suggestions,
      });
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(formatGenerationError(err));
    }
  };

  const handleDownload = async (deliverable: ParsedDeliverable, index: number) => {
    setDownloadingIndex(index);
    setDownloadError(null);
    try {
      const dataUrl =
        deliverable.kind === 'document'
          ? await buildDocxDataUrl(deliverable)
          : await buildPptxDataUrl(deliverable);
      await window.api.saveFile(dataUrl, suggestedFileName(deliverable));
    } catch (err) {
      setDownloadError({
        index,
        message: err instanceof Error ? err.message : t.textWork.fileError,
      });
    } finally {
      setDownloadingIndex(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const copyText = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex((cur) => (cur === index ? null : cur)), 1200);
  };

  return (
    <div className={`text-work-panel ${active ? '' : 'text-work-hidden'}`}>
      <div className="text-work-body">
        <div className="text-work-sidebar">
          <button className="text-work-new-btn" onClick={addThread}>
            <IconNotePlus size={14} /> {t.textWork.newDialog}
          </button>
          <div className="text-work-thread-list">
            {threads.map((th) => (
              <div
                key={th.id}
                className={`text-work-thread ${th.id === activeThreadId ? 'active' : ''}`}
                onClick={() => setActiveThreadId(th.id)}
                onDoubleClick={() => setEditingThreadId(th.id)}
              >
                {editingThreadId === th.id ? (
                  <input
                    className="text-work-thread-input"
                    autoFocus
                    defaultValue={th.title}
                    onClick={(e) => e.stopPropagation()}
                    onBlur={(e) => {
                      renameThread(th.id, e.target.value.trim() || th.title);
                      setEditingThreadId(null);
                    }}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                  />
                ) : (
                  <div className="text-work-thread-title">{th.title}</div>
                )}
                <button
                  className="text-work-thread-delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteThread(th.id);
                  }}
                  title={t.textWork.deleteDialogTooltip}
                >
                  <IconClose size={11} />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div className="text-work-chat">
          <div className="chat-log text-work-log" ref={listRef}>
            {activeThread.messages.length === 0 && (
              <div className="connected-hint">{t.textWork.emptyHint}</div>
            )}
            {activeThread.messages.map((m, i) => (
              <div key={i} className={`chat-bubble chat-${m.role}`}>
                <div className="chat-bubble-text">{m.content}</div>
                {m.deliverable && (
                  <>
                    <button
                      className="chat-deliverable-btn"
                      onClick={() => handleDownload(m.deliverable!, i)}
                      disabled={downloadingIndex === i}
                    >
                      <IconDownload size={13} />
                      {downloadingIndex === i
                        ? t.textWork.preparingFile
                        : m.deliverable.kind === 'document'
                          ? t.textWork.downloadDoc
                          : t.textWork.downloadPres}
                    </button>
                    {downloadError?.index === i && (
                      <div className="error-text">{downloadError.message}</div>
                    )}
                  </>
                )}
                <button className="chat-copy-btn" onClick={() => copyText(m.content, i)} title={t.textWork.copyTooltip}>
                  <IconCopy size={12} /> {copiedIndex === i ? t.textWork.copiedLabel : ''}
                </button>
              </div>
            ))}
            {status === 'loading' && <div className="chat-bubble chat-assistant chat-typing">...</div>}
          </div>

          {status === 'idle' && activeThread.suggestions && activeThread.suggestions.length > 0 && (
            <div className="chat-suggestions text-work-suggestions">
              {activeThread.suggestions.map((s, i) => (
                <button key={i} className="chat-suggestion-chip" onClick={() => handleSend(s)}>
                  {s}
                </button>
              ))}
            </div>
          )}

          {status === 'error' && <div className="error-text">{error}</div>}

          <div className="chat-input-row text-work-input-row">
            <textarea
              className="node-textarea chat-input"
              placeholder={t.textWork.inputPlaceholder}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
            />
            <button
              className="generate-btn chat-send-btn"
              onClick={() => handleSend()}
              disabled={status === 'loading' || !draft.trim()}
            >
              <IconSend />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
