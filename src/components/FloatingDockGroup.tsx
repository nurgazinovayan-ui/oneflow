import { useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform, type MotionValue } from 'framer-motion';

export interface DockItemDef {
  key: string;
  label: string;
  icon: ReactNode;
  onClick: () => void;
  active?: boolean;
  className?: string;
}

// Ported from the "Aceternity floating-dock" reference (motion/react's useMotionValue +
// useTransform + useSpring driving each item's size off distance-from-cursor) rather than the
// app's older hand-written proximity math in dockHover.ts — this project already ships
// framer-motion (same API surface as the reference's `motion/react`), so the real spring physics
// (mass/stiffness/damping straight from the reference) are used as-is instead of approximated
// with a CSS cubic-bezier overshoot.
const BASE_SIZE = 34;
const MAGNIFY_SIZE = 64;
const MAGNIFY_RADIUS = 140;
const SPRING = { mass: 0.1, stiffness: 150, damping: 12 };

export default function FloatingDockGroup({ items, className }: { items: DockItemDef[]; className?: string }) {
  const mouseX = useMotionValue(Infinity);
  return (
    <div
      className={`toolbar-group toolbar-dock-group ${className ?? ''}`}
      onMouseMove={(e) => mouseX.set(e.pageX)}
      onMouseLeave={() => mouseX.set(Infinity)}
    >
      {items.map(({ key, ...item }) => (
        <DockIcon key={key} mouseX={mouseX} {...item} />
      ))}
    </div>
  );
}

function DockIcon({ mouseX, label, icon, onClick, active, className }: DockItemDef & { mouseX: MotionValue<number> }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [hovered, setHovered] = useState(false);

  const distance = useTransform(mouseX, (val) => {
    const bounds = ref.current?.getBoundingClientRect() ?? { x: 0, width: 0 };
    return val - bounds.x - bounds.width / 2;
  });

  const sizeTransform = useTransform(distance, [-MAGNIFY_RADIUS, 0, MAGNIFY_RADIUS], [BASE_SIZE, MAGNIFY_SIZE, BASE_SIZE]);
  const size = useSpring(sizeTransform, SPRING);

  return (
    <div className="toolbar-icon-wrap" data-dock-wrap>
      <motion.button
        ref={ref}
        type="button"
        onClick={onClick}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{ width: size, height: size }}
        className={`toolbar-icon-btn toolbar-dock-icon-btn${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      >
        {icon}
      </motion.button>
      <AnimatePresence>
        {hovered && (
          <motion.span
            initial={{ opacity: 0, y: -6, x: '-50%' }}
            animate={{ opacity: 1, y: 0, x: '-50%' }}
            exit={{ opacity: 0, y: -6, x: '-50%' }}
            transition={{ duration: 0.15 }}
            className="toolbar-icon-label"
          >
            {label}
          </motion.span>
        )}
      </AnimatePresence>
    </div>
  );
}
