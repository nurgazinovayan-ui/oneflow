import { useCallback, useEffect, useRef, useState } from 'react';
import { parseSuggestions } from '../chatSuggestions';
import { parseDeliverable } from '../deliverables';
import { formatGenerationError } from '../errorMessages';
import { id, newWorkspace, type CwMessage, type Workspace } from './workspace';

const STORAGE_PREFIX = 'oneflow-copywrite:';

function loadWorkspace(scope: string, defaultTitle: string): { workspace: Workspace; loadError: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + scope);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Workspace>;
      if (parsed && Array.isArray(parsed.threads) && parsed.threads.length > 0) {
        return {
          workspace: {
            projects: Array.isArray(parsed.projects) ? parsed.projects : [],
            threads: parsed.threads,
            activeId:
              typeof parsed.activeId === 'string' && parsed.threads.some((t) => t.id === parsed.activeId)
                ? parsed.activeId
                : parsed.threads[0].id,
            sidebarCollapsed: Boolean(parsed.sidebarCollapsed),
          },
          loadError: false,
        };
      }
    }
    return { workspace: newWorkspace(defaultTitle), loadError: false };
  } catch {
    return { workspace: newWorkspace(defaultTitle), loadError: true };
  }
}

// Native, localStorage-backed replacement for the reference implementation's IndexedDB
// workspace — same surface (ready/pending/errors/send/regenerate/invalidate) so
// TextWorkPanel's behavior matches the spec, without a new persistence dependency. `scope`
// namespaces storage per signed-in account (or 'desktop-local'), and changing it is expected to
// remount the whole panel (see TextWorkPanel's `key={storageScope}`), so this hook always starts
// fresh for a new scope rather than migrating state between scopes.
export function useWorkspace(scope: string, defaultTitle: string) {
  const [workspace, setWorkspace] = useState<Workspace>(() => loadWorkspace(scope, defaultTitle).workspace);
  const [storageError, setStorageError] = useState<'load' | 'save' | null>(
    () => (loadWorkspace(scope, defaultTitle).loadError ? 'load' : null)
  );
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const cancelledRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_PREFIX + scope, JSON.stringify(workspace));
      setStorageError((prev) => (prev === 'save' ? null : prev));
    } catch {
      setStorageError('save');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspace, scope]);

  const update = useCallback((updater: (w: Workspace) => Workspace) => {
    setWorkspace((prev) => updater(prev));
  }, []);

  const invalidate = useCallback((threadId: string) => {
    cancelledRef.current.add(threadId);
  }, []);

  const runRequest = useCallback(
    async (threadId: string, messages: CwMessage[]) => {
      cancelledRef.current.delete(threadId);
      setPending((p) => ({ ...p, [threadId]: true }));
      setErrors((e) => ({ ...e, [threadId]: '' }));
      const lastUserImages = (messages[messages.length - 1]?.attachments ?? [])
        .filter((a) => a.kind === 'image')
        .map((a) => a.data)
        .slice(0, 4);
      try {
        const plain = messages.map((m) => ({ role: m.role, content: m.content }));
        const reply = await window.api.generateChat(plain, lastUserImages.length > 0 ? lastUserImages : undefined, 'text');
        if (cancelledRef.current.has(threadId)) return;
        const { cleanedText: afterSuggestions, suggestions } = parseSuggestions(reply);
        const { cleanedText, deliverable } = parseDeliverable(afterSuggestions);
        const assistantMessage: CwMessage = {
          id: id(),
          role: 'assistant',
          content: cleanedText || reply,
          deliverable: deliverable ?? undefined,
        };
        update((s) => ({
          ...s,
          threads: s.threads.map((t) =>
            t.id === threadId
              ? { ...t, messages: [...messages, assistantMessage], suggestions: suggestions ?? [], updatedAt: Date.now() }
              : t
          ),
        }));
      } catch (err) {
        if (cancelledRef.current.has(threadId)) return;
        setErrors((e) => ({ ...e, [threadId]: formatGenerationError(err) }));
      } finally {
        setPending((p) => ({ ...p, [threadId]: false }));
      }
    },
    [update]
  );

  // overrideText: used by suggestion chips (send a fixed follow-up instead of the draft).
  // editIndex: resending an edited user message — everything from that point on (the old
  // message plus whatever followed it) is replaced by the edited message and its new reply.
  const send = useCallback(
    (threadId: string, overrideText?: string, editIndex?: number) => {
      let toRun: { messages: CwMessage[] } | null = null;
      setWorkspace((prev) => {
        const thread = prev.threads.find((t) => t.id === threadId);
        if (!thread) return prev;
        const text = (overrideText ?? thread.draft).trim();
        if (!text) return prev;
        const baseMessages = editIndex !== undefined ? thread.messages.slice(0, editIndex) : thread.messages;
        const isFirst = baseMessages.length === 0;
        const userMessage: CwMessage = {
          id: id(),
          role: 'user',
          content: text,
          attachments: thread.attachments.length > 0 ? thread.attachments : undefined,
        };
        const nextMessages = [...baseMessages, userMessage];
        toRun = { messages: nextMessages };
        return {
          ...prev,
          threads: prev.threads.map((t) =>
            t.id === threadId
              ? {
                  ...t,
                  messages: nextMessages,
                  draft: '',
                  attachments: [],
                  suggestions: [],
                  updatedAt: Date.now(),
                  title: isFirst ? (text.length > 40 ? `${text.slice(0, 40)}…` : text) : t.title,
                }
              : t
          ),
        };
      });
      if (toRun) void runRequest(threadId, (toRun as { messages: CwMessage[] }).messages);
    },
    [runRequest]
  );

  // messageIndex omitted: retry after a failed send (thread already ends in a user message).
  // messageIndex given: regenerate that specific assistant reply — the old reply stays visible
  // until the new one lands successfully, since it isn't touched until runRequest's own update.
  const regenerate = useCallback(
    (threadId: string, messageIndex?: number) => {
      const thread = workspace.threads.find((t) => t.id === threadId);
      if (!thread) return;
      const cutIndex = messageIndex !== undefined ? messageIndex : thread.messages.length;
      const baseMessages = thread.messages.slice(0, cutIndex);
      void runRequest(threadId, baseMessages);
    },
    [workspace.threads, runRequest]
  );

  return { workspace, update, ready: true, storageError, pending, errors, send, regenerate, invalidate };
}
