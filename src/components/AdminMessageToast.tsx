import { useEffect, useRef, useState } from 'react';
import { IconChat, IconClose } from './Icons';
import type { AdminMessage } from '../types';
import { useT } from '../i18n';

const POLL_INTERVAL_MS = 45_000;

// Always mounted (regardless of which project/view is active) so a targeted admin message —
// see AdminSendMessageModal — pops up from the bottom no matter what the user is doing.
export default function AdminMessageToast() {
  const t = useT();
  const [messages, setMessages] = useState<AdminMessage[]>([]);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const incoming = await window.api.getPendingMessages();
        if (!cancelled && incoming.length > 0) {
          setMessages((prev) => {
            const existingIds = new Set(prev.map((m) => m.id));
            const fresh = incoming.filter((m) => !existingIds.has(m.id));
            return fresh.length > 0 ? [...prev, ...fresh] : prev;
          });
        }
      } catch {
        // Best-effort — a failed poll just tries again on the next interval.
      }
      // Piggybacks the "am I still online" ping onto this same timer rather than running a
      // second interval — see admin:get-online-users in electron/main.ts.
      try {
        await window.api.sendHeartbeat();
      } catch {
        // Best-effort — a failed heartbeat just tries again on the next interval.
      }
    };
    void poll();
    intervalRef.current = window.setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      if (intervalRef.current) window.clearInterval(intervalRef.current);
    };
  }, []);

  const dismiss = (id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  };

  if (messages.length === 0) return null;

  return (
    <div className="admin-toast-stack">
      {messages.map((m) => (
        <div key={m.id} className="admin-toast">
          <div className="admin-toast-icon">
            <IconChat size={14} />
          </div>
          <div className="admin-toast-body">{m.body}</div>
          <button className="admin-toast-close" onClick={() => dismiss(m.id)} title={t.common.close}>
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}
