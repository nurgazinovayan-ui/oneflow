import { forwardRef, type FC } from 'react';
import { motion, type Variants } from 'framer-motion';
import { useThemeStore } from '../theme';

// Ported from a shadcn/Tailwind "glow-menu" component into ONEFLOW's own stack: no Tailwind
// utility classes here (this app has none — see App.css's --c-* token system instead), no
// next-themes (the app already tracks its own theme in theme.ts's useThemeStore), and app icons
// (Icons.tsx) instead of lucide-react so we're not carrying two icon sets. The animation
// structure (3D flip on hover, per-item radial glow, a soft rainbow glow behind the whole bar)
// is kept as-is via framer-motion — that part is framework-agnostic.

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

const navGlowVariants: Variants = {
  initial: { opacity: 0 },
  hover: {
    opacity: 1,
    transition: { duration: 0.5, ease: EASE_OUT },
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
    const theme = useThemeStore((s) => s.theme);
    const isDark = theme === 'dark';

    return (
      <motion.nav
        ref={ref}
        className={`glow-menu ${className ?? ''}`}
        initial="initial"
        whileHover="hover"
      >
        <motion.div
          className="glow-menu-nav-glow"
          variants={navGlowVariants}
          style={{
            background: `radial-gradient(ellipse at center, transparent, ${
              isDark
                ? 'rgba(96,165,250,0.25), rgba(192,132,252,0.25) 40%, rgba(248,113,113,0.25) 70%'
                : 'rgba(96,165,250,0.16), rgba(192,132,252,0.16) 40%, rgba(248,113,113,0.16) 70%'
            }, transparent)`,
          }}
        />
        <ul className="glow-menu-list">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = item.value === activeValue;
            return (
              <motion.li key={item.value} className="glow-menu-item">
                <button type="button" className="glow-menu-item-btn" onClick={() => onSelect?.(item.value)}>
                  <motion.div className="glow-menu-item-inner" whileHover="hover" initial="initial">
                    <motion.div
                      className="glow-menu-item-glow"
                      variants={glowVariants}
                      animate={isActive ? 'hover' : 'initial'}
                      style={{ background: item.gradient, opacity: isActive ? 1 : 0 }}
                    />
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
