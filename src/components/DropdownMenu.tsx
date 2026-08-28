import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';

export type DropdownMenuItem =
  | { type?: 'item'; label: string; icon?: ComponentType<{ size?: number }>; onClick: () => void }
  | { type: 'header'; label: string };

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  onClose: () => void;
  align?: 'left' | 'right';
}

// Anchored dropdown (positioned via CSS relative to a `position: relative` trigger wrapper),
// as opposed to ContextMenu which is positioned at an arbitrary cursor x/y.
export default function DropdownMenu({ items, onClose, align = 'left' }: DropdownMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose]);

  return (
    <div className={`dropdown-menu dropdown-align-${align}`} ref={ref}>
      {items.map((item, i) => {
        if (item.type === 'header') {
          return (
            <div key={i} className="dropdown-menu-header">
              {item.label}
            </div>
          );
        }
        const Icon = item.icon;
        return (
          <button
            key={i}
            className="dropdown-menu-item"
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            <span>{item.label}</span>
            {Icon && <Icon size={14} />}
          </button>
        );
      })}
    </div>
  );
}
