"use client";

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
  const button = "inline-flex h-11 shrink-0 items-center justify-center rounded-lg border border-line bg-white/5 px-3 text-sm hover:bg-white/10 disabled:opacity-40";
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <button type="button" className={button} onClick={onBack} disabled={disabled} aria-label="Seek backward 15 seconds">
        −15s
      </button>
      <button type="button" className={button} onClick={onToggle} disabled={disabled} aria-label={playing ? "Pause" : "Play"}>
        {playing ? "Pause" : "Play"}
      </button>
      <button type="button" className={button} onClick={onForward} disabled={disabled} aria-label="Seek forward 15 seconds">
        +15s
      </button>
      <button type="button" className={button} onClick={onMute} disabled={disabled} aria-pressed={!muted} aria-label={muted ? "Unmute" : "Mute"}>
        {muted ? "Unmute" : "Mute"}
      </button>
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
          className="w-full"
        />
      </label>
      <button type="button" className={button} onClick={onFullscreen} disabled={disabled} aria-label="Full screen">
        Full screen
      </button>
    </div>
  );
}
