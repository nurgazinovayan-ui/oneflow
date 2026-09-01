interface IconProps {
  size?: number;
}

const base = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function IconDocument({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 2.5h9l5 5V21a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1Z" />
      <path d="M14.5 2.5V8h5" />
      <path d="M8 13h8M8 17h5" />
    </svg>
  );
}

export function IconImage({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.8" />
      <path d="m4 18 5.5-5.5a1.5 1.5 0 0 1 2.1 0L18 19" />
    </svg>
  );
}

export function IconSparkles({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M11 2.5 12.6 8l5.4 1.6-5.4 1.6L11 16.5 9.4 11.2 4 9.6l5.4-1.6L11 2.5Z" />
      <path d="M18.5 15.5 19.3 18l2.5.8-2.5.8-.8 2.5-.8-2.5-2.5-.8 2.5-.8.8-2.5Z" />
    </svg>
  );
}

export function IconVideo({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="2.5" y="5.5" width="13" height="13" rx="2" />
      <path d="m15.5 10 5.3-3.2a.8.8 0 0 1 1.2.7v9a.8.8 0 0 1-1.2.7L15.5 14v-4Z" />
    </svg>
  );
}

export function IconVector({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 18c3-8 7-8 8-14 1 6 5 6 8 14" />
      <circle cx="4" cy="19.5" r="1.6" />
      <circle cx="12" cy="4" r="1.6" />
      <circle cx="20" cy="19.5" r="1.6" />
    </svg>
  );
}

export function IconCrop({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </svg>
  );
}

export function IconSave({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 3.5h13L21 8v12.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-16a1 1 0 0 1 1-1Z" />
      <path d="M7 3.5V9h8V3.5" />
      <path d="M7 20.5v-6h10v6" />
    </svg>
  );
}

export function IconFolderOpen({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 7a1 1 0 0 1 1-1h5l2 2h9a1 1 0 0 1 1 1v1H5.5a1 1 0 0 0-.98.79L3 19" />
      <path d="m3 19 2-9.2A1 1 0 0 1 6 9h14.5a1 1 0 0 1 .98 1.21L20 19a1 1 0 0 1-1 .8H4a1 1 0 0 1-1-.8Z" />
    </svg>
  );
}

export function IconUser({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20.5c0-4.1 3.6-7.5 8-7.5s8 3.4 8 7.5" />
    </svg>
  );
}

export function IconSettings({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v2.4M12 19.1v2.4M4.6 4.6l1.7 1.7M17.7 17.7l1.7 1.7M2.5 12h2.4M19.1 12h2.4M4.6 19.4l1.7-1.7M17.7 6.3l1.7-1.7" />
    </svg>
  );
}

export function IconInfo({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="9.5" />
      <path d="M12 11v6" />
      <circle cx="12" cy="7.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconRefresh({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M20 11A8 8 0 0 0 6.3 6.3L4 8.6" />
      <path d="M4 4v4.6h4.6" />
      <path d="M4 13a8 8 0 0 0 13.7 4.7L20 15.4" />
      <path d="M20 20v-4.6h-4.6" />
    </svg>
  );
}

export function IconPlus({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function IconDownload({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 3v12" />
      <path d="m6.5 10.5 5.5 5.5 5.5-5.5" />
      <path d="M4 20.5h16" />
    </svg>
  );
}

export function IconChat({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M3 5.5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4.5v-4.5H5a2 2 0 0 1-2-2Z" />
      <path d="M7.5 9.5h9M7.5 13h6" />
    </svg>
  );
}

export function IconSend({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="m3 11 18-7-7 18-2.5-7.5L3 11Z" />
    </svg>
  );
}

export function IconCopy({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
      <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
    </svg>
  );
}

export function IconFlow({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="2.5" y="4" width="6" height="6" rx="1.5" />
      <rect x="15.5" y="2.5" width="6" height="6" rx="1.5" />
      <rect x="15.5" y="15.5" width="6" height="6" rx="1.5" />
      <path d="M8.5 7h3a2 2 0 0 1 2 2v.5M15.5 5.5h-2a2 2 0 0 0-2 2V11M15.5 18.5h-4a2 2 0 0 1-2-2v-3" />
    </svg>
  );
}

export function IconSun({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.6M12 18.9v2.6M4.6 4.6l1.8 1.8M17.6 17.6l1.8 1.8M2.5 12h2.6M18.9 12h2.6M4.6 19.4l1.8-1.8M17.6 6.4l1.8-1.8" />
    </svg>
  );
}

export function IconMoon({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M20 13.5A8.5 8.5 0 1 1 10.5 4a6.8 6.8 0 0 0 9.5 9.5Z" />
    </svg>
  );
}

export function IconNotePlus({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M13.5 3.5H6a1 1 0 0 0-1 1V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7.5" />
      <path d="M8 8h5M8 12h3" />
      <path d="M18.5 3.5v6M15.5 6.5h6" />
    </svg>
  );
}

export function IconClose({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconCheck({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M5 12.5 9.5 17 19 7" />
    </svg>
  );
}

export function IconChevronRight({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="m9 5 7 7-7 7" />
    </svg>
  );
}

export function IconChevronDown({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="m5 9 7 7 7-7" />
    </svg>
  );
}

export function IconArrowUp({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

export function IconCreditCard({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2" />
      <path d="M2.5 10h19" />
      <path d="M6 14.5h4" />
    </svg>
  );
}

export function IconGauge({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M4 16a8 8 0 0 1 16 0" />
      <path d="M12 16 16.2 9.5" />
      <circle cx="12" cy="16" r="1.4" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconTool({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17l3 3 5.3-5.3a4 4 0 0 1 5.4-5.4l-2.6 2.6-2-2 2.6-2.6Z" />
    </svg>
  );
}

export function IconMusic({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M9 18V4.5l11-2v13" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="15.5" r="2.5" />
    </svg>
  );
}

export function IconMic({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

export function IconPlay({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <path d="M7 4.5v15l13-7.5-13-7.5Z" />
    </svg>
  );
}

export function IconPause({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <rect x="6" y="4.5" width="4.5" height="15" rx="1" />
      <rect x="13.5" y="4.5" width="4.5" height="15" rx="1" />
    </svg>
  );
}

export function IconRocket({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" {...base}>
      <path d="M12 2.5c3 1.7 5 4.9 5 9 0 2-.6 3.8-1.6 5.3L12 19l-3.4-2.2C7.6 15.3 7 13.5 7 11.5c0-4.1 2-7.3 5-9Z" />
      <circle cx="12" cy="10.5" r="1.8" />
      <path d="M9 16.5 7 21l2.8-1.3M15 16.5l2 4.5-2.8-1.3" />
    </svg>
  );
}

// Deliberately filled/colored (not the shared `currentColor` outline style every other icon in
// this file uses) — the "Ассеты" button needs to read as a distinct colored folder glyph at a
// glance in the dark topbar, per the design ask, rather than blend in with the monochrome icons
// around it.
export function IconAssetsFolder({ size = 15 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M3 6.5a2 2 0 0 1 2-2h4.4l2.2 2.2H19a2 2 0 0 1 2 2V8H3V6.5Z" fill="#E8A93B" />
      <path d="M3 8h18v9.5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Z" fill="#FBC65D" />
    </svg>
  );
}
