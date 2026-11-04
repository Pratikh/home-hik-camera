import type { SVGProps } from "react";

/**
 * Inline SVG icon set for the Sentinel design system.
 *
 * No icon package and no external assets: the app's CSP is same-origin only and
 * a CDN/icon-font request would fail QA's clean-diagnostics contract. Every icon
 * is drawn on a 24px grid with a 1.7px stroke, inherits `currentColor`, and is
 * hidden from assistive technology (the accessible name always belongs to the
 * containing control or a visible text label).
 */

export type IconName =
  | "dashboard"
  | "camera"
  | "playback"
  | "events"
  | "faces"
  | "bell"
  | "device"
  | "settings"
  | "user"
  | "logout"
  | "clock"
  | "chevronLeft"
  | "chevronRight"
  | "chevronDown"
  | "search"
  | "filter"
  | "expand"
  | "close"
  | "plus"
  | "check"
  | "alert"
  | "info"
  | "refresh"
  | "arrowRight"
  | "external"
  | "database"
  | "activity"
  | "wifi"
  | "lock"
  | "shield"
  | "send"
  | "eye"
  | "calendar"
  | "image"
  | "volume"
  | "mute"
  | "play"
  | "pause"
  | "fullscreen"
  | "sliders"
  | "users"
  | "file"
  | "home"
  | "more"
  | "cpu"
  | "zap"
  | "scan"
  | "key"
  | "copy"
  | "trash"
  | "edit"
  | "power"
  | "download"
  | "monitor";

type Shape =
  | { d: string }
  | { c: [number, number, number] }
  | { r: [number, number, number, number, number?] }
  | { e: [number, number, number, number] };

const SHAPES: Record<IconName, Shape[]> = {
  dashboard: [
    { r: [3, 3, 7, 7, 1.5] },
    { r: [14, 3, 7, 7, 1.5] },
    { r: [3, 14, 7, 7, 1.5] },
    { r: [14, 14, 7, 7, 1.5] },
  ],
  camera: [
    { d: "M3 8.5A2.5 2.5 0 0 1 5.5 6h9A2.5 2.5 0 0 1 17 8.5v7a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 3 15.5z" },
    { d: "M17 10.5l4-2.5v8l-4-2.5" },
    { c: [9.5, 12, 1.6] },
  ],
  playback: [{ c: [12, 12, 9] }, { d: "M10.5 8.6l5 3.4-5 3.4z" }],
  events: [
    { d: "M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18.5z" },
    { d: "M8 9h8M8 13h8M8 17h4" },
  ],
  faces: [
    { d: "M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" },
    { c: [12, 10.4, 2.1] },
    { d: "M8.6 16c.5-1.7 1.8-2.6 3.4-2.6s2.9.9 3.4 2.6" },
  ],
  bell: [
    { d: "M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" },
    { d: "M10 19a2.2 2.2 0 0 0 4 0" },
  ],
  device: [
    { r: [3, 4, 18, 7, 1.6] },
    { r: [3, 13, 18, 7, 1.6] },
    { d: "M7 7.5h.01M7 16.5h.01" },
  ],
  settings: [
    { c: [12, 12, 3] },
    { d: "M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.55V21a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.55-1H3a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.55V3a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.5.62.87 1.16 1H21a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.51 1z" },
  ],
  user: [{ c: [12, 8, 3.4] }, { d: "M5 20c.6-3.2 3.5-5 7-5s6.4 1.8 7 5" }],
  logout: [
    { d: "M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" },
    { d: "M10 8l-4 4 4 4M6 12h9" },
  ],
  clock: [{ c: [12, 12, 8.5] }, { d: "M12 7.5V12l3 2" }],
  chevronLeft: [{ d: "M14.5 6l-6 6 6 6" }],
  chevronRight: [{ d: "M9.5 6l6 6-6 6" }],
  chevronDown: [{ d: "M6 9.5l6 6 6-6" }],
  search: [{ c: [10.5, 10.5, 6.5] }, { d: "M15.4 15.4L20 20" }],
  filter: [{ d: "M4 6h16M7 12h10M10 18h4" }],
  expand: [{ d: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" }],
  close: [{ d: "M6 6l12 12M18 6L6 18" }],
  plus: [{ d: "M12 5v14M5 12h14" }],
  check: [{ d: "M5 12.5l4.5 4.5L19 7.5" }],
  alert: [{ d: "M12 4.5l8.5 15H3.5z" }, { d: "M12 10v4M12 17.2h.01" }],
  info: [{ c: [12, 12, 8.5] }, { d: "M12 11v5M12 8h.01" }],
  refresh: [{ d: "M20 11a8 8 0 1 0-2.4 6.4" }, { d: "M20 5v6h-6" }],
  arrowRight: [{ d: "M5 12h14M13 6l6 6-6 6" }],
  external: [{ d: "M14 4h6v6M20 4l-9 9" }, { d: "M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" }],
  database: [
    { e: [12, 6, 7.5, 3] },
    { d: "M4.5 6v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3V6" },
    { d: "M4.5 12v6c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-6" },
  ],
  activity: [{ d: "M3 12h4l3-7 4 14 3-7h4" }],
  wifi: [
    { d: "M4.5 9.5a11 11 0 0 1 15 0M7.5 13a6.5 6.5 0 0 1 9 0M10.5 16.2a2.4 2.4 0 0 1 3 0" },
    { d: "M12 19.5h.01" },
  ],
  lock: [{ r: [4.5, 10, 15, 10, 2] }, { d: "M8 10V7.5a4 4 0 0 1 8 0V10" }],
  shield: [{ d: "M12 3l7 2.8v5.4c0 4.6-3 8-7 9.8-4-1.8-7-5.2-7-9.8V5.8z" }, { d: "M9 12l2.2 2.2L15.5 10" }],
  send: [{ d: "M20 4L3.5 10.5l6 2.2 2.2 6z" }, { d: "M20 4l-8.3 13.7" }],
  eye: [
    { d: "M2.5 12S6 6.5 12 6.5 21.5 12 21.5 12 18 17.5 12 17.5 2.5 12 2.5 12z" },
    { c: [12, 12, 2.6] },
  ],
  calendar: [{ r: [3.5, 5, 17, 15, 1.8] }, { d: "M3.5 9.5h17M8 3.5V6M16 3.5V6" }],
  image: [{ r: [3.5, 4.5, 17, 15, 1.8] }, { c: [9, 9.5, 1.6] }, { d: "M4.5 17l4.6-4.4 3.4 3.2 2.6-2.4 4.4 4" }],
  volume: [{ d: "M5 9.5h3l4-3.5v12l-4-3.5H5z" }, { d: "M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" }],
  mute: [{ d: "M5 9.5h3l4-3.5v12l-4-3.5H5z" }, { d: "M16 9.5l5 5M21 9.5l-5 5" }],
  play: [{ d: "M7 4.8l12 7.2-12 7.2z" }],
  pause: [{ d: "M8 5v14M16 5v14" }],
  fullscreen: [{ d: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" }],
  sliders: [{ d: "M4 8h9M17 8h3M4 16h3M11 16h9" }, { c: [15, 8, 2] }, { c: [9, 16, 2] }],
  users: [
    { c: [9, 8, 3] },
    { d: "M3 19c.5-2.7 2.8-4.2 6-4.2s5.5 1.5 6 4.2" },
    { d: "M16 5.5a3 3 0 0 1 0 5.6M18 19c-.2-1.7-.8-2.9-1.8-3.7" },
  ],
  file: [{ d: "M6 3.5h7l5 5v12H6z" }, { d: "M13 3.5V9h5M9 13h6M9 16.5h6" }],
  home: [{ d: "M4 10.5L12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-6h-5v6H5a1 1 0 0 1-1-1z" }],
  more: [{ c: [5, 12, 1.3] }, { c: [12, 12, 1.3] }, { c: [19, 12, 1.3] }],
  cpu: [{ r: [6, 6, 12, 12, 2] }, { r: [9.5, 9.5, 5, 5, 1] }, { d: "M9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3" }],
  zap: [{ d: "M13 3L5 14h6l-1 7 8-11h-6z" }],
  scan: [{ d: "M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16" }, { d: "M4 12h16" }],
  key: [{ c: [8, 14, 3.4] }, { d: "M10.6 11.4L19 3M15 7l2.4 2.4M17.6 4.4L20 6.8" }],
  copy: [{ r: [8, 8, 12, 12, 2] }, { d: "M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" }],
  trash: [{ d: "M4 7h16M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M6.5 7l.8 12.5A1.5 1.5 0 0 0 8.8 21h6.4a1.5 1.5 0 0 0 1.5-1.5L17.5 7" }, { d: "M10 11v6M14 11v6" }],
  edit: [{ d: "M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z" }, { d: "M13.5 6.5l3 3" }],
  power: [{ d: "M12 3v8" }, { d: "M6.5 6.8a8 8 0 1 0 11 0" }],
  download: [{ d: "M12 4v11M7.5 10.5L12 15l4.5-4.5" }, { d: "M5 19h14" }],
  monitor: [{ r: [3, 4, 18, 13, 2] }, { d: "M8 21h8M12 17v4" }],
};

export function Icon({
  name,
  className = "icon",
  strokeWidth = 1.7,
  ...rest
}: { name: IconName; className?: string; strokeWidth?: number } & Omit<SVGProps<SVGSVGElement>, "name">) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {SHAPES[name].map((shape, index) => {
        if ("d" in shape) return <path key={index} d={shape.d} />;
        if ("c" in shape) return <circle key={index} cx={shape.c[0]} cy={shape.c[1]} r={shape.c[2]} />;
        if ("r" in shape) {
          const [x, y, width, height, rx] = shape.r;
          return <rect key={index} x={x} y={y} width={width} height={height} rx={rx ?? 0} />;
        }
        const [cx, cy, rx, ry] = shape.e;
        return <ellipse key={index} cx={cx} cy={cy} rx={rx} ry={ry} />;
      })}
    </svg>
  );
}
