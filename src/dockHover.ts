import type { MouseEvent as ReactMouseEvent } from 'react';

// Dock-style hover magnification, shared by every "row of chips on a matte toolbar plaque" in
// the app (MusicAudioPanel's Music/Speech switch — canvas-toolbar's node-add icons use
// FloatingDockGroup.tsx's framer-motion spring instead) — items scale up as the cursor nears them
// and taper off with distance, like a macOS dock. Applied by writing `transform`/`margin` directly
// on the DOM nodes on every mousemove rather than through React state, so the effect stays smooth
// at pointer-move frequency without re-rendering the tree. The margin push (equal to half the
// extra visual width the scale-up adds) reserves the matching amount of flex-row space so
// neighbors get shouldered apart instead of being overlapped by the growing item — mirrors how a
// real dock grows an item's actual box size to make room, without us having to animate
// width/font-size separately for icon-only vs. text+icon buttons. Any element marked
// `data-dock-item` inside a container using these handlers participates; when it's wrapped in a
// `data-dock-wrap` (used by icon-only buttons so a name label can float below without affecting
// item spacing), the margin compensation is applied to that wrapper instead of the item itself.
// The actual spring-back easing lives in the `.musicaudio-mode-toolbar` transition rules in
// App.css.
const DOCK_MAGNIFY_RADIUS = 90;
const DOCK_MAGNIFY_SCALE = 0.32;

export function handleDockMouseMove(e: ReactMouseEvent<HTMLDivElement>) {
  const items = e.currentTarget.querySelectorAll<HTMLElement>('[data-dock-item]');
  items.forEach((item) => {
    const rect = item.getBoundingClientRect();
    const center = rect.left + rect.width / 2;
    const distance = Math.abs(e.clientX - center);
    const proximity = Math.max(0, 1 - distance / DOCK_MAGNIFY_RADIUS);
    const scale = 1 + proximity * DOCK_MAGNIFY_SCALE;
    item.style.transform = `translateY(${-proximity * 5}px) scale(${scale})`;
    const spacer = item.closest<HTMLElement>('[data-dock-wrap]') ?? item;
    const extraHalfWidth = (rect.width * (scale - 1)) / 2;
    spacer.style.marginLeft = `${extraHalfWidth}px`;
    spacer.style.marginRight = `${extraHalfWidth}px`;
  });
}

export function handleDockMouseLeave(e: ReactMouseEvent<HTMLDivElement>) {
  e.currentTarget.querySelectorAll<HTMLElement>('[data-dock-item]').forEach((item) => {
    item.style.transform = '';
    const spacer = item.closest<HTMLElement>('[data-dock-wrap]') ?? item;
    spacer.style.marginLeft = '';
    spacer.style.marginRight = '';
  });
}
