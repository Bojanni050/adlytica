import React from "react";

/**
 * Eén getekende iconenset voor de hele app: 20×20 raster, 1,4 px streek,
 * ronde uiteinden, currentColor. Geen unicode-glyphs — die vallen per
 * besturingssysteem anders uit en wegen visueel niet hetzelfde.
 *
 * Gebruik: <Icon name="overview" /> of <Icon name="close" size={14} />
 */
export type IconName =
  | "overview"
  | "tasks"
  | "search"
  | "rank"
  | "page"
  | "pulse"
  | "report"
  | "inspect"
  | "gauge"
  | "compare"
  | "megaphone"
  | "coins"
  | "tag"
  | "trend"
  | "sliders"
  | "refresh"
  | "download"
  | "pencil"
  | "close"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "grip"
  | "spark"
  | "check"
  | "plus"
  | "external"
  | "calendar"
  | "alert"
  | "arrowUp"
  | "arrowDown"
  | "panel"
  | "bolt";

const PATHS: Record<IconName, React.ReactNode> = {
  overview: (
    <>
      <rect x="2.6" y="2.6" width="6.3" height="6.3" rx="1.6" />
      <rect x="11.1" y="2.6" width="6.3" height="3.4" rx="1.3" />
      <rect x="11.1" y="8.4" width="6.3" height="9" rx="1.8" />
      <rect x="2.6" y="11.1" width="6.3" height="6.3" rx="1.6" />
    </>
  ),
  tasks: (
    <>
      <rect x="3.2" y="3.2" width="13.6" height="13.6" rx="3.4" />
      <path d="M6.9 10.2l2.1 2.1 4.3-4.6" />
    </>
  ),
  search: (
    <>
      <circle cx="9" cy="9" r="5.6" />
      <path d="M13.2 13.2l3.7 3.7" />
    </>
  ),
  rank: (
    <>
      <path d="M2.9 16.9h14.2" />
      <path d="M5.6 16.9v-4.3" />
      <path d="M10 16.9V8.5" />
      <path d="M14.4 16.9V3.4" />
    </>
  ),
  page: (
    <>
      <path d="M11.4 2.9H6.2a1.9 1.9 0 0 0-1.9 1.9v10.4a1.9 1.9 0 0 0 1.9 1.9h7.6a1.9 1.9 0 0 0 1.9-1.9V7.2z" />
      <path d="M11.4 2.9v4.3h4.3" />
      <path d="M7.4 11.3h5.2" />
      <path d="M7.4 14h3.4" />
    </>
  ),
  pulse: <path d="M2.6 10.6h2.9l2-4.9 2.9 9 2.1-6.1 1.5 2h3.4" />,
  report: (
    <>
      <rect x="3.4" y="2.9" width="13.2" height="14.2" rx="2.2" />
      <path d="M3.4 7.5h13.2" />
      <path d="M3.4 11.8h13.2" />
      <path d="M8.8 7.5v9.6" />
    </>
  ),
  inspect: (
    <>
      <path d="M2.9 7.1V4.9a2 2 0 0 1 2-2h2.2" />
      <path d="M12.9 2.9h2.2a2 2 0 0 1 2 2v2.2" />
      <path d="M17.1 12.9v2.2a2 2 0 0 1-2 2h-2.2" />
      <path d="M7.1 17.1H4.9a2 2 0 0 1-2-2v-2.2" />
      <circle cx="10" cy="10" r="2.6" />
    </>
  ),
  gauge: (
    <>
      <path d="M3.7 13.9a6.8 6.8 0 0 1 12.6 0" />
      <path d="M10 13.9l3.2-4.6" />
      <circle cx="10" cy="13.9" r="1.15" />
    </>
  ),
  compare: (
    <>
      <circle cx="7.7" cy="10" r="4.7" />
      <circle cx="12.3" cy="10" r="4.7" />
    </>
  ),
  megaphone: (
    <>
      <path d="M14.6 4.3v11.4l-7.2-4H4.6a1 1 0 0 1-1-1V9.3a1 1 0 0 1 1-1h2.8z" />
      <path d="M16.7 8.1a3.3 3.3 0 0 1 0 3.8" />
    </>
  ),
  coins: (
    <>
      <path d="M15.4 5.9c0 1.27-2.42 2.3-5.4 2.3S4.6 7.17 4.6 5.9 7.02 3.6 10 3.6s5.4 1.03 5.4 2.3z" />
      <path d="M4.6 5.9v3.6c0 1.27 2.42 2.3 5.4 2.3s5.4-1.03 5.4-2.3V5.9" />
      <path d="M4.6 9.5v3.6c0 1.27 2.42 2.3 5.4 2.3s5.4-1.03 5.4-2.3V9.5" />
    </>
  ),
  tag: (
    <>
      <path d="M3.4 9.1V4.6a1.2 1.2 0 0 1 1.2-1.2h4.5a1.2 1.2 0 0 1 .85.35l6.2 6.2a1.2 1.2 0 0 1 0 1.7l-4.4 4.4a1.2 1.2 0 0 1-1.7 0l-6.2-6.2a1.2 1.2 0 0 1-.35-.85z" />
      <circle cx="7.1" cy="7.1" r="1.15" />
    </>
  ),
  trend: (
    <>
      <path d="M2.6 15.6l5-5 3.4 3.4 6.4-6.4" />
      <path d="M13 4.4h4.4v4.4" />
    </>
  ),
  sliders: (
    <>
      <path d="M3.4 6.6h13.2" />
      <path d="M3.4 13.4h13.2" />
      <circle cx="12.4" cy="6.6" r="1.9" />
      <circle cx="7.1" cy="13.4" r="1.9" />
    </>
  ),
  refresh: (
    <>
      <path d="M16.6 6.4A6.6 6.6 0 1 0 16.6 13.6" />
      <path d="M17.1 2.9v3.7h-3.7" />
    </>
  ),
  download: (
    <>
      <path d="M10 3.2v9.6" />
      <path d="M6.3 9.4L10 13.1l3.7-3.7" />
      <path d="M3.6 16.8h12.8" />
    </>
  ),
  pencil: (
    <>
      <path d="M3.6 16.4l.9-3.6 8.6-8.6a1.6 1.6 0 0 1 2.3 0l1.4 1.4a1.6 1.6 0 0 1 0 2.3l-8.6 8.6z" />
      <path d="M12 4.9l3.1 3.1" />
    </>
  ),
  close: (
    <>
      <path d="M5.2 5.2l9.6 9.6" />
      <path d="M14.8 5.2l-9.6 9.6" />
    </>
  ),
  chevronLeft: <path d="M12.4 4.6L7 10l5.4 5.4" />,
  chevronRight: <path d="M7.6 4.6L13 10l-5.4 5.4" />,
  chevronDown: <path d="M4.6 7.6L10 13l5.4-5.4" />,
  grip: (
    <>
      <circle cx="7.5" cy="5.6" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="5.6" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="10" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="10" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="7.5" cy="14.4" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="14.4" r="1.05" fill="currentColor" stroke="none" />
    </>
  ),
  spark: (
    <path d="M10 2.4c.55 4.1 2.9 6.45 7 7-4.1.55-6.45 2.9-7 7-.55-4.1-2.9-6.45-7-7 4.1-.55 6.45-2.9 7-7z" />
  ),
  check: <path d="M4.4 10.4l3.6 3.6 7.6-8.2" />,
  plus: (
    <>
      <path d="M10 4.4v11.2" />
      <path d="M4.4 10h11.2" />
    </>
  ),
  external: (
    <>
      <path d="M8.6 4.4H5.2a1.4 1.4 0 0 0-1.4 1.4v9a1.4 1.4 0 0 0 1.4 1.4h9a1.4 1.4 0 0 0 1.4-1.4v-3.4" />
      <path d="M11.6 3.4h5v5" />
      <path d="M16.6 3.4L9.8 10.2" />
    </>
  ),
  calendar: (
    <>
      <rect x="2.8" y="4.8" width="14.4" height="12.4" rx="2.2" />
      <path d="M2.8 8.7h14.4" />
      <path d="M6.8 2.9v3.4" />
      <path d="M13.2 2.9v3.4" />
    </>
  ),
  alert: (
    <>
      <path d="M8.9 4.1L2.7 15.1a1.3 1.3 0 0 0 1.1 1.95h12.4a1.3 1.3 0 0 0 1.1-1.95L11.1 4.1a1.3 1.3 0 0 0-2.2 0z" />
      <path d="M10 8.3v3.3" />
      <path d="M10 14.5h.01" />
    </>
  ),
  arrowUp: (
    <>
      <path d="M10 16.4V3.8" />
      <path d="M4.8 9L10 3.8 15.2 9" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M10 3.6v12.6" />
      <path d="M15.2 11L10 16.2 4.8 11" />
    </>
  ),
  panel: (
    <>
      <rect x="3.2" y="4.4" width="13.6" height="11.2" rx="2.2" />
      <path d="M12.4 4.4v11.2" />
    </>
  ),
  bolt: <path d="M11.4 2.8L4.2 11.4h4.4l-1 5.8 7.2-8.6h-4.4z" />,
};

interface Props {
  name: IconName;
  size?: number;
  strokeWidth?: number;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
}

export default function Icon({ name, size = 18, strokeWidth = 1.4, className, title, style }: Props) {
  return (
    <svg
      className={className ? `icon ${className}` : "icon"}
      style={style}
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
      focusable="false"
    >
      {title && <title>{title}</title>}
      {PATHS[name]}
    </svg>
  );
}
