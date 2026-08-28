import { useRef, useState, useEffect } from 'react';
import { IconChat, IconSend, IconCopy, IconClose } from './Icons';
import type { ChatMessage } from '../types';
import { parseAssistantReply, type AssistantAction } from '../aiActions';
import { parseSuggestions } from '../chatSuggestions';
import { formatGenerationError } from '../errorMessages';
import { useT } from '../i18n';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

interface Attachment {
  name: string;
  kind: 'image' | 'document';
  content: string;
}

const readFileAsDataUrl = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

const readFileAsText = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsText(file);
  });

interface AiAssistantPanelProps {
  messages: ChatMessage[];
  draft: string;
  onMessagesChange: (messages: ChatMessage[]) => void;
  onDraftChange: (draft: string) => void;
  onClose: () => void;
  onExecuteActions: (actions: AssistantAction[]) => number;
}

export default function AiAssistantPanel({
  messages,
  draft,
  onMessagesChange,
  onDraftChange,
  onClose,
  onExecuteActions,
}: AiAssistantPanelProps) {
  const t = useT();
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | undefined>();
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [dockCorner, setDockCorner] = useState<Corner>('bottom-left');
  const [dragging, setDragging] = useState(false);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [fileDropActive, setFileDropActive] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length, status]);

  const handleSend = async (overrideText?: string) => {
    const text = (overrideText ?? draft).trim();
    if ((!text && attachments.length === 0) || status === 'loading') return;

    const documentBlocks = attachments
      .filter((a) => a.kind === 'document')
      .map((a) => `${t.aiAssistant.documentLabel(a.name)}\n${a.content}`);
    const imageNotes = attachments
      .filter((a) => a.kind === 'image')
      .map((a) => t.aiAssistant.imageAttachedLabel(a.name));
    const fullText = [...documentBlocks, ...imageNotes, text].filter(Boolean).join('\n\n');
    const imageDataUrls = attachments.filter((a) => a.kind === 'image').map((a) => a.content);

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', content: fullText }];
    onMessagesChange(nextMessages);
    onDraftChange('');
    setAttachments([]);
    setSuggestions(null);
    setStatus('loading');
    setError(undefined);
    try {
      const reply = await window.api.generateChat(
        nextMessages,
        imageDataUrls.length > 0 ? imageDataUrls : undefined,
        'assistant'
      );
      const { cleanedText: afterActions, actions } = parseAssistantReply(reply);
      const { cleanedText, suggestions: parsedSuggestions } = parseSuggestions(afterActions || reply);
      let displayText = cleanedText;
      if (actions) {
        const createdCount = onExecuteActions(actions);
        displayText += createdCount > 0 ? t.aiAssistant.addedNodes(createdCount) : t.aiAssistant.failedNodes;
      }
      onMessagesChange([...nextMessages, { role: 'assistant', content: displayText }]);
      setSuggestions(parsedSuggestions);
      setStatus('idle');
    } catch (err) {
      setStatus('error');
      setError(formatGenerationError(err));
    }
  };

  const handleFileDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setFileDropActive(true);
  };

  const handleFileDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setFileDropActive(false);
  };

  const handleFileDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setFileDropActive(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      if (file.type.startsWith('image/')) {
        const dataUrl = await readFileAsDataUrl(file);
        setAttachments((prev) => [...prev, { name: file.name, kind: 'image', content: dataUrl }]);
      } else {
        const text = await readFileAsText(file);
        setAttachments((prev) => [...prev, { name: file.name, kind: 'document', content: text }]);
      }
    }
  };

  const removeAttachment = (index: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.stopPropagation();
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

  const copyAll = () => {
    const transcript = messages
      .map(
        (m) =>
          `${m.role === 'user' ? t.aiAssistant.transcriptUser : t.aiAssistant.transcriptAssistant}: ${m.content}`
      )
      .join('\n\n');
    copyText(transcript, -1);
  };

  const handleHeaderMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    const container = panelRef.current?.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    setDragging(true);

    const updateCorner = (clientX: number, clientY: number) => {
      const relX = clientX - rect.left;
      const relY = clientY - rect.top;
      const horiz = relX < rect.width / 2 ? 'left' : 'right';
      const vert = relY < rect.height / 2 ? 'top' : 'bottom';
      setDockCorner(`${vert}-${horiz}` as Corner);
    };

    const onMove = (ev: MouseEvent) => updateCorner(ev.clientX, ev.clientY);
    const onUp = (ev: MouseEvent) => {
      updateCorner(ev.clientX, ev.clientY);
      setDragging(false);
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  return (
    <div ref={panelRef} className={`ai-panel dock-${dockCorner} ${dragging ? 'dragging' : ''}`}>
      <div className="ai-panel-header" onMouseDown={handleHeaderMouseDown}>
        <span className="ai-panel-title">
          <IconChat /> {t.aiAssistant.title}
        </span>
        <div className="ai-panel-header-actions">
          <button onClick={copyAll} title={t.aiAssistant.copyAllTooltip} disabled={messages.length === 0}>
            <IconCopy />
            {copiedIndex === -1 ? ` ${t.aiAssistant.copiedLabel}` : ''}
          </button>
          <button onClick={onClose} title={t.aiAssistant.closeTooltip}>
            <IconClose />
          </button>
        </div>
      </div>
      <div
        className={`ai-panel-body ${fileDropActive ? 'file-drop-active' : ''}`}
        onDragOver={handleFileDragOver}
        onDragLeave={handleFileDragLeave}
        onDrop={handleFileDrop}
      >
        <div className="chat-log" ref={listRef}>
          {messages.length === 0 && <div className="connected-hint">{t.aiAssistant.emptyHint}</div>}
          {messages.map((m, i) => (
            <div key={i} className={`chat-bubble chat-${m.role}`}>
              <div className="chat-bubble-text">{m.content}</div>
              <button className="chat-copy-btn" onClick={() => copyText(m.content, i)} title={t.aiAssistant.copyTooltip}>
                <IconCopy size={12} /> {copiedIndex === i ? t.aiAssistant.copiedLabel : ''}
              </button>
            </div>
          ))}
          {status === 'loading' && <div className="chat-bubble chat-assistant chat-typing">...</div>}
        </div>

        {status === 'idle' && suggestions && suggestions.length > 0 && (
          <div className="chat-suggestions">
            {suggestions.map((s, i) => (
              <button key={i} className="chat-suggestion-chip" onClick={() => handleSend(s)}>
                {s}
              </button>
            ))}
          </div>
        )}

        {status === 'error' && <div className="error-text">{error}</div>}

        {attachments.length > 0 && (
          <div className="chat-attachments">
            {attachments.map((a, i) => (
              <div key={i} className="chat-attachment-chip" title={a.name}>
                {a.kind === 'image' ? (
                  <img src={a.content} alt={a.name} className="chat-attachment-thumb" />
                ) : (
                  <span className="chat-attachment-doc">📄</span>
                )}
                <span className="chat-attachment-name">{a.name}</span>
                <button
                  className="chat-attachment-remove"
                  onClick={() => removeAttachment(i)}
                  title={t.aiAssistant.removeTooltip}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="chat-input-row">
          <textarea
            className="node-textarea chat-input"
            placeholder={t.aiAssistant.inputPlaceholder}
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={handleKeyDown}
          />
          <button
            className="generate-btn chat-send-btn"
            onClick={() => handleSend()}
            disabled={status === 'loading' || (!draft.trim() && attachments.length === 0)}
          >
            <IconSend />
          </button>
        </div>

        {fileDropActive && <div className="chat-drop-overlay">{t.aiAssistant.dropHint}</div>}
      </div>
    </div>
  );
}
