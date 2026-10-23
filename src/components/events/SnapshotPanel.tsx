"use client";

import { useState } from "react";
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
 */
export function SnapshotPanel({
  eventId,
  hasSnapshot,
  title,
  detection = null,
}: {
  eventId: string;
  hasSnapshot: boolean;
  title: string;
  detection?: SnapshotDetection | null;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);

  if (!hasSnapshot || failed) {
    return (
      <p className="mt-3 rounded-lg border border-line bg-black/30 px-3 py-8 text-center text-xs text-muted">
        {Messages.snapshotUnavailable}
      </p>
    );
  }

  const overlay =
    loaded &&
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
          label: `${(detection.classification ?? detection.rawClass ?? "object").toUpperCase()}${
            detection.confidence !== null ? ` ${Math.round(detection.confidence * 100)}%` : ""
          }`,
        }
      : null;

  return (
    <figure className="mt-3">
      {!loaded ? <p className="mb-2 text-xs text-muted">{Messages.checking}</p> : null}
      <div className="relative overflow-hidden rounded-lg border border-line bg-black/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/events/${eventId}/snapshot`}
          alt={`Snapshot for ${title}`}
          onError={() => setFailed(true)}
          onLoad={(event) => {
            setLoaded(true);
            setNatural({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight,
            });
          }}
          className="block h-auto w-full"
        />
        {overlay ? (
          <div
            className="pointer-events-none absolute rounded-sm border-2 border-teal shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
            style={overlay.style}
            data-testid="detection-overlay"
          >
            <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-black/75 px-1.5 py-0.5 text-[11px] font-medium text-teal">
              {overlay.label}
            </span>
          </div>
        ) : null}
      </div>
      <figcaption className="mt-2 text-xs text-muted">
        {overlay ? "Event snapshot with the detection box from the object detector." : "Event snapshot"}
      </figcaption>
    </figure>
  );
}
