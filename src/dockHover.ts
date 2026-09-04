import type { MouseEvent as ReactMouseEvent } from 'react';

// Dock-style hover magnification, shared by every "row of chips on a matte toolbar plaque" in
// the app (canvas-toolbar's adaptation presets, and MusicAudioPanel's Music/Speech switch —
// canvas-toolbar's node-add icons use FloatingDockGroup.tsx's framer-motion spring instead) —
// items scale up as the cursor nears them and taper off with distance, like a macOS dock. Applied
// by writing `transform`/`margin` directly on the DOM nodes on every mousemove rather than through
// React state, so the effect stays smooth at pointer-move frequency without re-rendering the
// tree. The margin push (equal to half the extra visual size the scale-up adds) reserves the
// matching amount of flex space so neighbors get shouldered apart instead of being overlapped by
// the growing item — mirrors how a real dock grows an item's actual box size to make room.
// `orientation: 'vertical'` (used by the left-edge vertical canvas-toolbar) tracks the cursor's Y
// instead of X and pushes marginTop/marginBottom instead of marginLeft/marginRight; horizontal
// (the default) is unchanged. Any element marked `data-dock-item` inside a container using these
// handlers participates; when it's wrapped in a `data-dock-wrap` (used by icon-only buttons so a
// name label can float without affecting item spacing), the margin compensation is applied to
// that wrapper instead of the item itself. The actual spring-back easing lives in the
// `.canvas-toolbar`/`.musicaudio-mode-toolbar` transition rules in App.css.
const DOCK_MAGNIFY_RADIUS = 90;
const DOCK_MAGNIFY_SCALE = 0.32;

export function handleDockMouseMove(e: ReactMouseEvent<HTMLDivElement>, orientation: 'horizontal' | 'vertical' = 'horizontal') {
  const items = e.currentTarget.querySelectorAll<HTMLElement>('[data-dock-item]');
  items.forEach((item) => {
    const rect = item.getBoundingClientRect();
    const isVertical = orientation === 'vertical';
    const center = isVertical ? rect.top + rect.height / 2 : rect.left + rect.width / 2;
    const distance = Math.abs((isVertical ? e.clientY : e.clientX) - center);
    const proximity = Math.max(0, 1 - distance / DOCK_MAGNIFY_RADIUS);
    const scale = 1 + proximity * DOCK_MAGNIFY_SCALE;
    item.style.transform = isVertical
      ? `translateX(${proximity * 5}px) scale(${scale})`
      : `translateY(${-proximity * 5}px) scale(${scale})`;
    const spacer = item.closest<HTMLElement>('[data-dock-wrap]') ?? item;
    if (isVertical) {
      const extraHalfHeight = (rect.height * (scale - 1)) / 2;
      spacer.style.marginTop = `${extraHalfHeight}px`;
      spacer.style.marginBottom = `${extraHalfHeight}px`;
    } else {
      const extraHalfWidth = (rect.width * (scale - 1)) / 2;
      spacer.style.marginLeft = `${extraHalfWidth}px`;
      spacer.style.marginRight = `${extraHalfWidth}px`;
    }
  });
}

export function handleDockMouseLeave(e: ReactMouseEvent<HTMLDivElement>) {
  e.currentTarget.querySelectorAll<HTMLElement>('[data-dock-item]').forEach((item) => {
    item.style.transform = '';
    const spacer = item.closest<HTMLElement>('[data-dock-wrap]') ?? item;
    spacer.style.marginLeft = '';
    spacer.style.marginRight = '';
    spacer.style.marginTop = '';
    spacer.style.marginBottom = '';
  });
}
