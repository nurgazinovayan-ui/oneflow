import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export interface ToolbarRichMenuItem {
  title: string;
  description: string;
  icon: ComponentType<{ size?: number }>;
  onClick: () => void;
}

export type ToolbarRichMenuEntry = ToolbarRichMenuItem | { type: 'header'; label: string };

interface ToolbarRichMenuProps {
  items: ToolbarRichMenuEntry[];
  onClose: () => void;
  /** The trigger button (or its wrapper) this menu is anchored under — used both to position the
   * portalled panel and to exclude clicks on the trigger itself from the outside-click handler. */
  anchorRef: RefObject<HTMLElement>;
  align?: 'left' | 'right';
  wide?: boolean;
}

// Richer sibling of DropdownMenu.tsx — icon box + title + description per item (ported from a
// shadcn/Tailwind NavigationMenu reference, onto ONEFLOW's own --c-* tokens), used for the top
// toolbar's Файл/Шаблоны/Инструменты/О программе menus. Portals to document.body and positions
// itself with `position: fixed` off the trigger's own bounding rect — .top-toolbar establishes
// its own stacking context (position:relative; z-index:2), so a plain absolutely-positioned
// child can never out-rank the floating .canvas-toolbar pill row (z-index:6, but compared at the
// app-shell root since .canvas-area doesn't isolate it) once this menu grows tall enough to
// physically reach that far down — the old plain DropdownMenu never hit that ceiling because its
// items had no description line. Portaling sidesteps the whole stacking-context question.
export default function ToolbarRichMenu({ items, onClose, anchorRef, align = 'left', wide = false }: ToolbarRichMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    setPos(
      align === 'right'
        ? { top: rect.bottom + 6, right: window.innerWidth - rect.right }
        : { top: rect.bottom + 6, left: rect.left }
    );
  }, [anchorRef, align]);

  useEffect(() => {
    const handlePointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (panelRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
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
  }, [onClose, anchorRef]);

  if (!pos) return null;

  return createPortal(
    <div
      className={`toolbar-rich-menu ${wide ? 'wide' : ''}`}
      style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right }}
      ref={panelRef}
    >
      {items.map((item, i) =>
        'type' in item ? (
          <div key={i} className="toolbar-rich-menu-header">
            {item.label}
          </div>
        ) : (
          <button
            key={i}
            type="button"
            className="toolbar-rich-menu-item"
            onClick={() => {
              item.onClick();
              onClose();
            }}
          >
            <span className="toolbar-rich-menu-item-icon">
              <item.icon size={18} />
            </span>
            <span className="toolbar-rich-menu-item-text">
              <span className="toolbar-rich-menu-item-title">{item.title}</span>
              <span className="toolbar-rich-menu-item-desc">{item.description}</span>
            </span>
          </button>
        )
      )}
    </div>,
    document.body
  );
}
