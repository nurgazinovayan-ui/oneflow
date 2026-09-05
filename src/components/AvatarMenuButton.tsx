import { useRef } from 'react';
import ToolbarRichMenu, { type ToolbarRichMenuEntry } from './ToolbarRichMenu';
import { IconUser } from './Icons';

interface AvatarMenuButtonProps {
  title: string;
  items: ToolbarRichMenuEntry[];
  isOpen: boolean;
  onOpen: () => void;
  onClose: () => void;
  hasActiveSubscription: boolean;
}

// Round avatar trigger for the top toolbar, opening a right-aligned ToolbarRichMenu below it
// (same portalled panel File/Templates/Tools use) — click-toggled rather than hover-intent, per
// the shadcn DropdownMenu reference this was ported from, since a profile menu opening on a
// passing hover would be surprising here. The ring around it doubles as a subscription-status
// signal — green glow when active, raspberry glow otherwise (see .toolbar-avatar-btn in App.css).
export default function AvatarMenuButton({
  title,
  items,
  isOpen,
  onOpen,
  onClose,
  hasActiveSubscription,
}: AvatarMenuButtonProps) {
  const anchorRef = useRef<HTMLButtonElement>(null);

  return (
    <div className="toolbar-menu-wrapper">
      <button
        ref={anchorRef}
        type="button"
        className={`toolbar-avatar-btn ${hasActiveSubscription ? 'avatar-sub-active' : 'avatar-sub-inactive'}`}
        title={title}
        onClick={() => (isOpen ? onClose() : onOpen())}
      >
        <IconUser />
      </button>
      {isOpen && <ToolbarRichMenu align="right" anchorRef={anchorRef} onClose={onClose} items={items} />}
    </div>
  );
}
