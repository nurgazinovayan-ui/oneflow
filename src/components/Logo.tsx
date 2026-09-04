interface LogoProps {
  className?: string;
}

// Icon + wordmark, both solid currentColor — the icon is a blocky "pixel" zigzag (rounded-square
// steps forming a mountain/flow silhouette), approximating the attached reference logo. A raster
// reference can't be traced into an exact vector path, so this is a close geometric match rather
// than a pixel-for-pixel reproduction — swap in the real SVG file here if/when one is provided.
export default function Logo({ className }: LogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 640 100"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ONEFLOW"
    >
      <rect x="0" y="40" width="20" height="20" rx="5" fill="currentColor" />
      <rect x="20" y="20" width="20" height="40" rx="5" fill="currentColor" />
      <rect x="40" y="0" width="20" height="60" rx="5" fill="currentColor" />
      <rect x="60" y="20" width="20" height="40" rx="5" fill="currentColor" />
      <rect x="80" y="40" width="20" height="20" rx="5" fill="currentColor" />
      <text
        x="118"
        y="64"
        fontFamily="'Arial Black', Arial, 'Segoe UI', sans-serif"
        fontWeight="900"
        fontSize="60"
        letterSpacing="-1.5"
        fill="currentColor"
      >
        ONEFLOW
      </text>
    </svg>
  );
}
