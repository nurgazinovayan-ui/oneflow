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
      aria-label="ONEFLOW by Nurgazinov Ayan"
    >
      <text
        x="0"
        y="104"
        fontFamily="'Arial Black', Arial, 'Segoe UI', sans-serif"
        fontWeight="900"
        fontSize="106"
        letterSpacing="-3"
        fill="#E5157E"
      >
        ONEFLOW
      </text>
      <text
        x="3"
        y="138"
        fontFamily="'Segoe UI', Arial, sans-serif"
        fontWeight="700"
        fontSize="24"
        letterSpacing="0.5"
        fill="#9a9a9a"
      >
        by nurgazinov ayan
      </text>
    </svg>
  );
}
