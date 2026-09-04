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
  /** 'below' (default) opens under the anchor, aligned per `align`. 'side' opens to the anchor's
   * right, top-aligned with it — used by the vertical left-edge dock's adaptation-preset button,
   * where "below" would run toward the bottom of the screen instead of into open canvas. */
  placement?: 'below' | 'side';
  /** Hover-intent support: keep the menu open while the pointer is over the portalled panel
   * itself (it lives outside the trigger's DOM subtree once portalled to document.body). */
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
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
export default function ToolbarRichMenu({
  items,
  onClose,
  anchorRef,
  align = 'left',
  wide = false,
  placement = 'below',
  onMouseEnter,
  onMouseLeave,
}: ToolbarRichMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    if (placement === 'side') {
      setPos({ top: rect.top, left: rect.right + 8 });
      return;
    }
    setPos(
      align === 'right'
        ? { top: rect.bottom + 6, right: window.innerWidth - rect.right }
        : { top: rect.bottom + 6, left: rect.left }
    );
  }, [anchorRef, align, placement]);

  // Boundary clamp: a left-anchored menu near an edge of the window (Файл/Шаблоны/Инструменты/О
  // программе all live at the right edge; the vertical dock's 'side' menu opens near the bottom
  // of the screen) can extend past the viewport before its real size is known — this runs once
  // the panel has actually rendered (with real dimensions to measure) and pulls it back in from
  // whichever edge it overflows. Converges in one correction: after clamping, the new pos no
  // longer overflows, so the effect is a no-op on rerun.
  useLayoutEffect(() => {
    if (!pos) return;
    const panel = panelRef.current;
    if (!panel) return;
    const margin = 8;
    const rect = panel.getBoundingClientRect();
    const next = { ...pos };
    let changed = false;
    if (pos.left !== undefined) {
      const maxLeft = window.innerWidth - rect.width - margin;
      const clampedLeft = Math.min(pos.left, Math.max(margin, maxLeft));
      if (clampedLeft !== pos.left) {
        next.left = clampedLeft;
        changed = true;
      }
    }
    const maxTop = window.innerHeight - rect.height - margin;
    const clampedTop = Math.min(pos.top, Math.max(margin, maxTop));
    if (clampedTop !== pos.top) {
      next.top = clampedTop;
      changed = true;
    }
    if (changed) setPos(next);
  }, [pos]);

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
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
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
