interface LogoProps {
  className?: string;
}

// Icon + wordmark, both solid currentColor — replaces the text-only wordmark per the reference
// screenshot (icon glyph to the left of "ONEFLOW"). The mark itself is a simple angular "flow"
// zigzag rather than an exact trace of the screenshot's icon (a raster reference can't be
// reproduced pixel-for-pixel as vector) — swap in the real SVG file here if/when it's provided.
export default function Logo({ className }: LogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 640 120"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ONEFLOW"
    >
      <path
        d="M8 90 L34 30 L58 66 L84 18 L110 90"
        fill="none"
        stroke="currentColor"
        strokeWidth="14"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <text
        x="132"
        y="84"
        fontFamily="'Arial Black', Arial, 'Segoe UI', sans-serif"
        fontWeight="900"
        fontSize="76"
        letterSpacing="-2"
        fill="currentColor"
      >
        ONEFLOW
      </text>
    </svg>
  );
}
