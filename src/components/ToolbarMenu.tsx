import { useRef, type ComponentType } from 'react';
import ToolbarRichMenu, { type ToolbarRichMenuEntry } from './ToolbarRichMenu';
import { IconChevronDown } from './Icons';

interface ToolbarMenuProps {
  label: string;
  icon: ComponentType<{ size?: number }>;
  items: ToolbarRichMenuEntry[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  wide?: boolean;
}

const CLOSE_DELAY_MS = 150;

// Trigger button + portalled panel for the top toolbar's Файл/Шаблоны/Инструменты/О программе
// menus. Opens on hover (not click), matching the shadcn/Radix NavigationMenu reference — a
// shared timer lets the pointer travel from the trigger to the portalled panel (they aren't DOM
// siblings once portalled) without the menu flashing closed in between.
export default function ToolbarMenu({ label, icon: Icon, items, isOpen, onOpen, onClose, wide = false }: ToolbarMenuProps) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  const scheduleClose = () => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, CLOSE_DELAY_MS);
  };

  return (
    <div
      className="toolbar-menu-wrapper"
      ref={anchorRef}
      onMouseEnter={() => {
        clearCloseTimer();
        onOpen();
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        type="button"
        className="toolbar-label-btn"
        onClick={() => (isOpen ? onClose() : onOpen())}
      >
        <Icon size={13} /> {label}
        <span className={`toolbar-menu-chevron${isOpen ? ' open' : ''}`}>
          <IconChevronDown size={13} />
        </span>
      </button>
      {isOpen && (
        <ToolbarRichMenu
          align="left"
          wide={wide}
          anchorRef={anchorRef}
          onClose={onClose}
          onMouseEnter={clearCloseTimer}
          onMouseLeave={scheduleClose}
          items={items}
        />
      )}
    </div>
  );
}
