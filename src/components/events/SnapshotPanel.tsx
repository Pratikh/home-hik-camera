"use client";

import { useCallback, useState } from "react";
import { Messages } from "@/lib/messages";

export type SnapshotDetection = {
  rawClass: string | null;
  classification: string | null;
  confidence: number | null;
  x: number | null;
  y: number | null;
  width: number | null;
  height: number | null;
};

/**
 * Event snapshot, loaded from the authenticated route, plus an optional
 * bounding box drawn from the stored AI detection.
 *
 * This is annotation only: the box comes from the server-side detector that ran
 * when the event was created. The browser never performs inference.
 *
 * The box carries its label inside its own top-left corner, so the annotation
 * can never be clipped by the frame on a narrow screen.
 */
export function SnapshotPanel({
  eventId,
  hasSnapshot,
  title,
  detection = null,
  timestampLabel,
  cameraLabel,
}: {
  eventId: string;
  hasSnapshot: boolean;
  title: string;
  detection?: SnapshotDetection | null;
  /** India-time stamp for the footer bar, e.g. "04 Nov 2026, 13:54:19". */
  timestampLabel?: string;
  /** Camera identity for the footer bar, e.g. "Camera 4 · Left Side Outside". */
  cameraLabel?: string;
}) {
  const [failed, setFailed] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  /*
   * The server-rendered image can finish loading before React hydrates, in which
   * case `onLoad` never fires. Measuring the element the first time React
   * attaches it covers that case, so the footer dimensions and the detection box
   * still appear — and a pre-hydration 404 still degrades to the honest fallback.
   */
  const attachImage = useCallback((image: HTMLImageElement | null) => {
    if (!image || !image.complete) return;
    if (image.naturalWidth > 0) {
      setNatural({ width: image.naturalWidth, height: image.naturalHeight });
    } else {
      setFailed(true);
    }
  }, []);

  const showImage = hasSnapshot && !failed;

  const overlay =
    showImage &&
    natural &&
    detection &&
    detection.x !== null &&
    detection.y !== null &&
    detection.width !== null &&
    detection.height !== null
      ? {
          style: {
            left: `${Math.max(0, (detection.x / natural.width) * 100)}%`,
            top: `${Math.max(0, (detection.y / natural.height) * 100)}%`,
            width: `${Math.min(100, (detection.width / natural.width) * 100)}%`,
            height: `${Math.min(100, (detection.height / natural.height) * 100)}%`,
          },
          label: `${(detection.classification ?? detection.rawClass ?? "object").toLowerCase()}${
            detection.confidence !== null ? ` · ${Math.round(detection.confidence * 100)}%` : ""
          }`,
        }
      : null;

  const barLeft = showImage
    ? `Snapshot${natural ? ` · ${natural.width}×${natural.height}` : ""}${
        timestampLabel ? ` · ${timestampLabel}` : ""
      }`
    : Messages.snapshotUnavailable;

  return (
    <section className="detail-media" aria-label="Event snapshot">
      <div className="relative">
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            ref={attachImage}
            src={`/api/events/${eventId}/snapshot`}
            alt={`Snapshot for ${title}`}
            onError={() => setFailed(true)}
            onLoad={(event) => {
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              });
            }}
            className="block h-auto w-full"
          />
        ) : (
          <div className="flex aspect-[4/3] items-center justify-center px-6 text-center text-xs text-muted">
            {Messages.snapshotUnavailable}
          </div>
        )}
        {overlay ? (
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-teal shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={overlay.style}
            data-testid="detection-overlay"
          >
            <span className="absolute left-0 top-0 whitespace-nowrap rounded-br-sm rounded-tl-sm bg-black/80 px-1.5 py-0.5 font-mono text-[10px] font-medium text-teal">
              {overlay.label}
            </span>
          </div>
        ) : null}
      </div>
      <div className="detail-media__bar">
        <span className="min-w-0 truncate">{barLeft}</span>
        {cameraLabel ? <span className="shrink-0">{cameraLabel}</span> : null}
      </div>
    </section>
  );
}
