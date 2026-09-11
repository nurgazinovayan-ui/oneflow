import type { CSSProperties } from 'react';

// The placeholder shown while an image or video generation is in flight — two rounded squares
// walking around the corners of a box, half a cycle apart. Replaces the Lottie animation this
// used to render (and the bare spinner before that): same idea, but pure CSS, so there's no
// JSON asset to fetch, no animation library in the bundle, and it inherits --c-text instead of
// carrying its own baked-in colours through a theme switch.
//
// The animation itself lives in App.css (.gen-loader, @keyframes gen-loader); `size` sets the
// box's edge and the keyframes scale off it.
interface GenerationLoaderProps {
  className?: string;
  size?: number;
}

export default function GenerationLoader({ className, size }: GenerationLoaderProps) {
  return (
    <div className={className ? `gen-loader ${className}` : 'gen-loader'}>
      <div
        className="gen-loader-shape"
        style={size ? ({ '--gen-loader-size': `${size}px` } as CSSProperties) : undefined}
      >
        <span />
        <span />
      </div>
    </div>
  );
}
