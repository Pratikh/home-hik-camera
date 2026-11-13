"use client";

/**
 * Playback control bar.
 *
 * The same buttons, two presentations:
 * - Desktop keeps compact labelled controls plus a volume slider in one row.
 * - Touch layouts (phones/tablets) use 48px icon targets in a single row with
 *   the volume slider moved onto its own line, so nothing is a 6px tap target.
 *
 * Button labels (the accessible names) are unchanged, so existing keyboard and
 * end-to-end coverage keeps working.
 */
export function PlaybackControls({
  playing,
  muted,
  volume,
  disabled,
  onToggle,
  onBack,
  onForward,
  onMute,
  onVolume,
  onFullscreen,
}: {
  playing: boolean;
  muted: boolean;
  volume: number;
  disabled: boolean;
  onToggle: () => void;
  onBack: () => void;
  onForward: () => void;
  onMute: () => void;
  onVolume: (volume: number) => void;
  onFullscreen: () => void;
}) {
  const base =
    "inline-flex shrink-0 items-center justify-center rounded-lg border border-line bg-white/5 text-sm hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal disabled:opacity-40";
  const icon = `${base} h-12 w-12`;
  const labelled = `${base} h-11 px-3`;

  const volumeInput = (
    <label className="flex min-w-24 flex-1 items-center gap-2 text-xs text-muted">
      <span className="sr-only">Volume</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.05}
        value={muted ? 0 : volume}
        disabled={disabled}
        aria-label="Volume"
        onChange={(event) => onVolume(Number(event.target.value))}
        className="w-full accent-teal"
      />
    </label>
  );

  return (
    <div className="flex flex-col gap-2">
      {/* Touch: big icon buttons, one row. */}
      <div className="flex items-center justify-center gap-2 md:hidden">
        <button type="button" className={icon} onClick={onBack} disabled={disabled} aria-label="Seek backward 15 seconds">
          <Back15Icon />
        </button>
        <button
          type="button"
          className={`${base} h-14 w-14 border-teal/50 bg-teal/15 text-teal`}
          onClick={onToggle}
          disabled={disabled}
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button type="button" className={icon} onClick={onForward} disabled={disabled} aria-label="Seek forward 15 seconds">
          <Forward15Icon />
        </button>
        <button
          type="button"
          className={icon}
          onClick={onMute}
          disabled={disabled}
          aria-pressed={!muted}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? <MutedIcon /> : <SoundIcon />}
        </button>
        <button type="button" className={icon} onClick={onFullscreen} disabled={disabled} aria-label="Full screen">
          <FullscreenIcon />
        </button>
      </div>
      <div className="md:hidden">{volumeInput}</div>

      {/* Desktop: compact labelled row with the slider inline. */}
      <div className="hidden flex-wrap items-center gap-1.5 md:flex">
        <button type="button" className={labelled} onClick={onBack} disabled={disabled} aria-label="Seek backward 15 seconds">
          −15s
        </button>
        <button type="button" className={labelled} onClick={onToggle} disabled={disabled} aria-label={playing ? "Pause" : "Play"}>
          {playing ? "Pause" : "Play"}
        </button>
        <button type="button" className={labelled} onClick={onForward} disabled={disabled} aria-label="Seek forward 15 seconds">
          +15s
        </button>
        <button
          type="button"
          className={labelled}
          onClick={onMute}
          disabled={disabled}
          aria-pressed={!muted}
          aria-label={muted ? "Unmute" : "Mute"}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
        {volumeInput}
        <button type="button" className={labelled} onClick={onFullscreen} disabled={disabled} aria-label="Full screen">
          Full screen
        </button>
      </div>
    </div>
  );
}

function svgProps(extra?: string) {
  return {
    viewBox: "0 0 24 24",
    className: `h-6 w-6 ${extra ?? ""}`,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
}

function PlayIcon() {
  return (
    <svg {...svgProps()} fill="currentColor" stroke="none">
      <path d="M8 5.14v13.72a1 1 0 0 0 1.5.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg {...svgProps()} fill="currentColor" stroke="none">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

function Back15Icon() {
  return (
    <svg {...svgProps()}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <text x="12" y="15.5" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none" fontWeight="700">
        15
      </text>
    </svg>
  );
}

function Forward15Icon() {
  return (
    <svg {...svgProps()}>
      <path d="M21 12a9 9 0 1 1-3-6.7" />
      <path d="M21 4v5h-5" />
      <text x="12" y="15.5" textAnchor="middle" fontSize="7" fill="currentColor" stroke="none" fontWeight="700">
        15
      </text>
    </svg>
  );
}

function SoundIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="M15.5 8.5a5 5 0 0 1 0 7" />
    </svg>
  );
}

function MutedIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M11 5 6 9H3v6h3l5 4V5Z" />
      <path d="m16 9 5 6M21 9l-5 6" />
    </svg>
  );
}

function FullscreenIcon() {
  return (
    <svg {...svgProps()}>
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}
