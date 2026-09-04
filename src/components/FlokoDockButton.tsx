import { IconChat } from './Icons';

interface FlokoDockButtonProps {
  name: string;
  status: string;
  chatLabel: string;
  onClick: () => void;
}

// Ported from a shadcn/Tailwind "agent-dock" reference onto this app's own CSS (no Tailwind
// here) — same dark rounded-2xl card, avatar + name/status column, chat trigger with a decorative
// kbd hint. Dropped the reference's own voice/mic button (by request) and its inline composing
// mode/textarea: this app already has a full chat surface (AiAssistantPanel), so the chat button
// just opens that instead of duplicating a second composer inside the dock itself.
export default function FlokoDockButton({ name, status, chatLabel, onClick }: FlokoDockButtonProps) {
  return (
    <button type="button" className="floko-dock" onClick={onClick}>
      <span className="floko-avatar" aria-hidden="true">
        <IconChat size={17} />
      </span>
      <span className="floko-info">
        <span className="floko-name">{name}</span>
        <span className="floko-status">{status}</span>
      </span>
      <span className="floko-chat-btn">
        <IconChat size={15} />
        <span>{chatLabel}</span>
        <kbd className="floko-kbd">C</kbd>
      </span>
    </button>
  );
}
