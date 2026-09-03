import { forwardRef, type FC } from 'react';
import { motion, type Variants } from 'framer-motion';

// Ported from a shadcn/Tailwind "glow-menu" component into ONEFLOW's own stack: no Tailwind
// utility classes here (this app has none — see App.css's --c-* token system instead), no
// next-themes, and app icons (Icons.tsx) instead of lucide-react so we're not carrying two icon
// sets. The animation structure (3D flip + per-item radial glow on hover) is kept via
// framer-motion — that part is framework-agnostic. Unlike the original reference, the glow is
// scoped to the hovered item only — the original also washed the whole bar's background in a
// blended rainbow glow on hover, which read as "the panel lights up" rather than "this item is
// highlighted", so that whole-bar layer was dropped.

export interface GlowMenuItem {
  icon: FC<{ size?: number }>;
  label: string;
  value: string;
  gradient: string;
  iconColor: string;
}

interface GlowMenuBarProps {
  className?: string;
  items: GlowMenuItem[];
  activeValue?: string;
  onSelect?: (value: string) => void;
}

const EASE_OUT = [0.4, 0, 0.2, 1] as const;

const itemVariants: Variants = {
  initial: { rotateX: 0, opacity: 1 },
  hover: { rotateX: -90, opacity: 0 },
};

const backVariants: Variants = {
  initial: { rotateX: 90, opacity: 0 },
  hover: { rotateX: 0, opacity: 1 },
};

const glowVariants: Variants = {
  initial: { opacity: 0, scale: 0.8 },
  hover: {
    opacity: 1,
    scale: 2,
    transition: {
      opacity: { duration: 0.5, ease: EASE_OUT },
      scale: { duration: 0.5, type: 'spring', stiffness: 300, damping: 25 },
    },
  },
};

const sharedTransition = {
  type: 'spring' as const,
  stiffness: 100,
  damping: 20,
  duration: 0.5,
};

export const GlowMenuBar = forwardRef<HTMLElement, GlowMenuBarProps>(
  ({ className, items, activeValue, onSelect }, ref) => {
    return (
      <motion.nav ref={ref} className={`glow-menu ${className ?? ''}`}>
        <ul className="glow-menu-list">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.value === activeValue;
            return (
              <motion.li key={item.value} className="glow-menu-item">
                <button type="button" className="glow-menu-item-btn" onClick={() => onSelect?.(item.value)}>
                  <motion.div className="glow-menu-item-inner" initial="initial" whileHover="hover">
                    {/* Hover glow only — no `animate` override here, so it purely follows this
                        item's own whileHover state instead of the whole bar's. */}
                    <motion.div
                      className="glow-menu-item-glow"
                      variants={glowVariants}
                      style={{ background: item.gradient }}
                    />
                    {isActive && (
                      <div className="glow-menu-item-active-tint" style={{ background: `${item.iconColor}22` }} />
                    )}
                    <motion.div
                      className={`glow-menu-item-face glow-menu-item-front ${isActive ? 'active' : ''}`}
                      variants={itemVariants}
                      transition={sharedTransition}
                    >
                      <span className="glow-menu-icon" style={{ color: isActive ? item.iconColor : undefined }}>
                        <Icon size={17} />
                      </span>
                      <span>{item.label}</span>
                    </motion.div>
                    <motion.div
                      className={`glow-menu-item-face glow-menu-item-back ${isActive ? 'active' : ''}`}
                      variants={backVariants}
                      transition={sharedTransition}
                    >
                      <span className="glow-menu-icon" style={{ color: isActive ? item.iconColor : undefined }}>
                        <Icon size={17} />
                      </span>
                      <span>{item.label}</span>
                    </motion.div>
                  </motion.div>
                </button>
              </motion.li>
            );
          })}
        </ul>
      </motion.nav>
    );
  }
);

GlowMenuBar.displayName = 'GlowMenuBar';
