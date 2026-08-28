interface LogoProps {
  className?: string;
}

export default function Logo({ className }: LogoProps) {
  return (
    <svg
      className={className}
      viewBox="0 0 620 150"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label="ONEFLOW"
    >
      <text
        x="0"
        y="104"
        fontFamily="'Arial Black', Arial, 'Segoe UI', sans-serif"
        fontWeight="900"
        fontSize="106"
        letterSpacing="-3"
        fill="#17171b"
      >
        ONEFLOW
      </text>
    </svg>
  );
}
