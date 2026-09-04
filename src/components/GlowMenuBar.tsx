import { forwardRef, type FC } from 'react';
import { motion } from 'framer-motion';

// Ported from a shadcn/Tailwind "tubelight-navbar" reference into ONEFLOW's own stack: no
// Tailwind utility classes here (this app has none — see App.css's --c-* token system instead),
// no next/link (onSelect callback instead), and app icons (Icons.tsx) instead of lucide-react so
// we're not carrying two icon sets. The reference's single `--primary` accent is mapped onto the
// app's own --c-pink accent (already used for the AI-assistant button, the Тариф pill, etc.)
// rather than keeping this bar's old per-item rainbow color scheme. The "lamp" sliding highlight
// is framer-motion's shared-layout animation (`layoutId="lamp"`) exactly as in the reference —
// it automatically tweens position/size between whichever item is currently marked active.

export interface GlowMenuItem {
  icon: FC<{ size?: number }>;
  label: string;
  value: string;
}

interface GlowMenuBarProps {
  className?: string;
  items: GlowMenuItem[];
  activeValue?: string;
  onSelect?: (value: string) => void;
}

export const GlowMenuBar = forwardRef<HTMLElement, GlowMenuBarProps>(
  ({ className, items, activeValue, onSelect }, ref) => {
    return (
      <nav ref={ref} className={`glow-menu ${className ?? ''}`}>
        <ul className="glow-menu-list">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.value === activeValue;
            return (
              <li key={item.value} className="glow-menu-item">
                <button
                  type="button"
                  className={`glow-menu-item-btn${isActive ? ' active' : ''}`}
                  onClick={() => onSelect?.(item.value)}
                >
                  <span className="glow-menu-icon">
                    <Icon size={17} />
                  </span>
                  <span>{item.label}</span>
                  {isActive && (
                    <motion.div
                      layoutId="lamp"
                      className="glow-menu-lamp"
                      initial={false}
                      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                    >
                      <div className="glow-menu-lamp-bar">
                        <div className="glow-menu-lamp-blob glow-menu-lamp-blob-1" />
                        <div className="glow-menu-lamp-blob glow-menu-lamp-blob-2" />
                        <div className="glow-menu-lamp-blob glow-menu-lamp-blob-3" />
                      </div>
                    </motion.div>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    );
  }
);

GlowMenuBar.displayName = 'GlowMenuBar';
