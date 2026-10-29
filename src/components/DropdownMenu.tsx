import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { IconCheck } from './Icons';

export type DropdownMenuItem =
  | {
      type?: 'item';
      label: string;
      icon?: ComponentType<{ size?: number }>;
      danger?: boolean;
      /** a second, quieter line under the label */
      hint?: string;
      /** a choice list (e.g. the Copywrite model): the chosen item gets a check mark */
      checked?: boolean;
      onClick: () => void;
    }
  | { type: 'header'; label: string };

interface DropdownMenuProps {
  items: DropdownMenuItem[];
  onClose: () => void;
  align?: 'left' | 'right';
  /** 'up' for a trigger near the bottom of the screen (e.g. in a composer) */
  direction?: 'down' | 'up';
  className?: string;
}

// Anchored dropdown (positioned via CSS relative to a `position: relative` trigger wrapper),
// as opposed to ContextMenu which is positioned at an arbitrary cursor x/y.
export default function DropdownMenu({ items, onClose, align = 'left', direction = 'down', className = '' }: DropdownMenuProps) {
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
    <div className={`dropdown-menu dropdown-align-${align}${direction === 'up' ? ' dropdown-up' : ''}${className ? ` ${className}` : ''}`} ref={ref}>
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
            role={item.checked === undefined ? undefined : 'menuitemradio'}
            aria-checked={item.checked}
            className={`dropdown-menu-item${item.danger ? ' danger' : ''}${item.checked ? ' checked' : ''}`}
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            {item.hint ? (
              <span className="dropdown-menu-text">
                {item.label}
                <small>{item.hint}</small>
              </span>
            ) : (
              <span>{item.label}</span>
            )}
            {item.checked ? <IconCheck size={14} /> : Icon && <Icon size={14} />}
          </button>
        );
      })}
    </div>
  );
}
