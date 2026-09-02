import { useEffect, useRef } from 'react';
import lottie, { type AnimationItem } from 'lottie-web';

interface LottieLoaderProps {
  path: string;
  className?: string;
}

// Fills its parent with a looping Lottie animation — used in place of the old empty-square/
// spinner placeholder shown while an image or video generation is in flight (see
// QuickGenPanel's .quick-gen-tile.loading). One <div> host, lottie-web renders its own SVG
// into it; the animation instance is destroyed on unmount so nothing keeps running/leaking
// once a tile finishes or is removed.
export default function LottieLoader({ path, className }: LottieLoaderProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    let anim: AnimationItem | null = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path,
    });
    return () => {
      anim?.destroy();
      anim = null;
    };
  }, [path]);

  return <div ref={containerRef} className={className} />;
}
