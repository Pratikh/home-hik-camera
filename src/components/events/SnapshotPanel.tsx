"use client";

import { useState } from "react";
import { Messages } from "@/lib/messages";

/**
 * Event snapshot, loaded from the authenticated route. The image request
 * carries the session cookie, so nothing is served from a public directory.
 */
export function SnapshotPanel({
  eventId,
  hasSnapshot,
  title,
}: {
  eventId: string;
  hasSnapshot: boolean;
  title: string;
}) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  if (!hasSnapshot || failed) {
    return (
      <p className="mt-3 rounded-lg border border-line bg-black/30 px-3 py-8 text-center text-xs text-muted">
        {Messages.snapshotUnavailable}
      </p>
    );
  }

  return (
    <figure className="mt-3">
      {!loaded ? <p className="mb-2 text-xs text-muted">{Messages.checking}</p> : null}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`/api/events/${eventId}/snapshot`}
        alt={`Snapshot for ${title}`}
        onError={() => setFailed(true)}
        onLoad={() => setLoaded(true)}
        className="aspect-video w-full rounded-lg border border-line object-cover"
      />
      <figcaption className="mt-2 text-xs text-muted">Event snapshot from the DVR</figcaption>
    </figure>
  );
}