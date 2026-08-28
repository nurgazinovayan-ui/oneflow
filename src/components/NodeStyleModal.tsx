import type { CSSProperties, ReactNode } from 'react';
import { IconClose } from './Icons';

interface NodeStyleModalProps {
  title: string;
  icon?: ReactNode;
  accent?: string;
  width?: number;
  onClose: () => void;
  children: ReactNode;
}

// Shared chrome for the "Инструменты" toolbar popups (background remover, upscaler, photo
// editor) — deliberately styled like a canvas node card (.node/.node-header) rather than the
// app's generic .modal, per that menu's design brief. Clicking the dimmed backdrop closes it,
// same as the standard modals.
export default function NodeStyleModal({ title, icon, accent, width, onClose, children }: NodeStyleModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="node-modal"
        style={{ '--node-accent': accent ?? 'var(--c-pink)', width } as CSSProperties}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="node-modal-header">
          {icon}
          <span className="node-modal-title">{title}</span>
          <button className="node-modal-close" onClick={onClose}>
            <IconClose size={13} />
          </button>
        </div>
        <div className="node-modal-body">{children}</div>
      </div>
    </div>
  );
}
