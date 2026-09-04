import { useRef, type ComponentType } from 'react';
import ToolbarRichMenu, { type ToolbarRichMenuEntry } from './ToolbarRichMenu';

interface AdaptDockMenuButtonProps {
  icon: ComponentType<{ size?: number }>;
  label: string;
  items: ToolbarRichMenuEntry[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
}

const CLOSE_DELAY_MS = 150;

// Round dock-style trigger (same look as FloatingDockGroup's icon circles, but static — it opens
// a menu rather than acting directly, so it doesn't participate in that group's magnify spring)
// for the vertical left-edge canvas-toolbar's adaptation presets — collapses what used to be five
// always-visible chips into one button, opening a side panel (ToolbarRichMenu's placement="side")
// on hover, same hover-intent timer as ToolbarMenu.tsx uses for the top menus.
export default function AdaptDockMenuButton({ icon: Icon, label, items, isOpen, onOpen, onClose }: AdaptDockMenuButtonProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);
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
      className="toolbar-icon-wrap"
      onMouseEnter={() => {
        clearCloseTimer();
        onOpen();
      }}
      onMouseLeave={scheduleClose}
    >
      <button
        ref={anchorRef}
        type="button"
        title={label}
        className="toolbar-icon-btn toolbar-dock-icon-btn"
        onClick={() => (isOpen ? onClose() : onOpen())}
      >
        <Icon size={16} />
      </button>
      {isOpen && (
        <ToolbarRichMenu
          placement="side"
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
