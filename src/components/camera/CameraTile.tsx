"use client";

import type { CameraView } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { LivePlayer } from "@/components/camera/LivePlayer";
import { MessagePanel } from "@/components/ui/States";
import { StatusLamp } from "@/components/ui/StatusLamp";

/**
 * One camera in the grid.
 *
 * Clicking anywhere in the video area opens the camera in the application's
 * focus mode. The trigger is a button overlay at z-10; the player's own controls
 * sit at z-20 above it and stop propagation, so Mute / Retry still work.
 *
 * The video keeps its own aspect ratio (`object-contain`), so the picture is
 * never stretched or cropped; leftover space becomes letterboxing.
 */
export function CameraTile({
  camera,
  suspended,
  active,
  focused,
  hidden = false,
  onExpand,
  onExitFocus,
}: {
  camera: CameraView;
  suspended: string | null;
  active: boolean;
  /** When true this tile's video fills the viewport in focus mode. */
  focused: boolean;
  /**
   * Hidden while another camera is focused. Uses `display: none` so the
   * component stays mounted and its WebRTC session is never torn down.
   */
  hidden?: boolean;
  onExpand: () => void;
  onExitFocus: () => void;
}) {
  const tone = camera.online === true ? "online" : camera.online === false ? "offline" : "warn";
  const signal = camera.online === true ? Messages.online : camera.online === false ? Messages.offline : Messages.notReported;

  return (
    /*
      In focus mode this article becomes a fixed, full-viewport surface. The
      player inside it is the SAME element that was in the grid, so the WebRTC
      session is never torn down and re-created when entering or leaving focus.
    */
    <article
      className={
        focused
          ? "fixed inset-0 z-50 flex min-h-0 min-w-0 flex-col overflow-hidden bg-black"
          : `group relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-card${
              hidden ? " hidden" : ""
            }`
      }
      aria-label={focused ? `${camera.name} focus view` : undefined}
    >
      <div
        className={
          focused
            ? "relative min-h-0 w-full flex-1 basis-0 bg-black"
            : "relative aspect-video min-h-0 w-full bg-black lg:aspect-auto lg:flex-1 lg:basis-0"
        }
      >
        {suspended ? (
          <MessagePanel message={suspended} />
        ) : (
          <LivePlayer path={camera.subPath} active={active} label={camera.name} />
        )}

        {focused ? (
          /*
            Focus mode: minimal overlay controls. The exit button is anchored to
            the top-right, clear of the DVR's burned-in timestamp (top-left) and
            the player's own Mute control (bottom-left).
          */
          <>
            <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3 sm:p-5">
              <span className="rounded-lg border border-white/15 bg-black/60 px-3 py-2 text-sm font-medium text-white">
                {camera.name}
              </span>
              <button
                type="button"
                onClick={onExitFocus}
                className="pointer-events-auto inline-flex h-11 shrink-0 items-center gap-2 rounded-lg border border-white/25 bg-black/70 px-3 text-sm font-medium text-white hover:bg-black/90"
                aria-label={`Exit focus view for ${camera.name}`}
                autoFocus
              >
                <CloseIcon />
                Exit
              </button>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end p-3 sm:p-5">
              <StatusLamp tone={tone} label={signal} compact />
            </div>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={onExpand}
              aria-label={`Open ${camera.name} full screen`}
              className="absolute inset-0 z-10 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal"
            />
            <span className="pointer-events-none absolute right-2 top-2 z-20 inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/20 bg-black/60 px-2.5 text-xs font-medium text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              <ExpandIcon />
              Full screen
            </span>
          </>
        )}
      </div>

      {/* The caption row is only part of the grid presentation. */}
      {focused ? null : (
        <div className="flex shrink-0 items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <h2 className="truncate text-sm font-semibold">{camera.name}</h2>
            <p className="mt-0.5 font-mono text-xs text-muted">Sub {camera.subChannel}</p>
          </div>
          <StatusLamp tone={tone} label={signal} />
        </div>
      )}
    </article>
  );
}

function ExpandIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}