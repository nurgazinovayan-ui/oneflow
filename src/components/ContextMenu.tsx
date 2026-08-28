import { useEffect, useRef } from 'react';
import type { ComponentType } from 'react';
import { useT } from '../i18n';

export interface ContextMenuOption<T extends string> {
  type: T;
  label: string;
  icon: ComponentType<{ size?: number }>;
}

interface ContextMenuProps<T extends string> {
  x: number;
  y: number;
  options: ContextMenuOption<T>[];
  onSelect: (type: T) => void;
  onClose: () => void;
}

export default function ContextMenu<T extends string>({
  x,
  y,
  options,
  onSelect,
  onClose,
}: ContextMenuProps<T>) {
  const t = useT();
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
    <div className="context-menu" ref={ref} style={{ left: x, top: y }}>
      <div className="context-menu-title">{t.contextMenu.addNode}</div>
      {options.map((opt) => {
        const Icon = opt.icon;
        return (
          <button
            key={opt.type}
            className="context-menu-item"
            onClick={() => {
              onSelect(opt.type);
              onClose();
            }}
          >
            <span>{opt.label}</span>
            <Icon />
          </button>
        );
      })}
    </div>
  );
}
