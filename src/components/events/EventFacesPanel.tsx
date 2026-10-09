"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { EventFacesResponse } from "@/lib/faces";
import { faceAssignmentLabel, formatFaceConfidence } from "@/lib/faces";
import { Messages } from "@/lib/messages";

/**
 * Detected faces for one event.
 *
 * When face detection is disabled the API reports `enabled:false` and this
 * renders nothing at all — an event detail page must never claim "0 faces" for
 * a feature that is switched off. A failure to load is equally silent: the
 * event page itself must stay intact.
 */
export function EventFacesPanel({ eventId }: { eventId: string }) {
  const [data, setData] = useState<EventFacesResponse | null>(null);

  useEffect(() => {
    let ignore = false;
    void api<EventFacesResponse>(`/api/events/${eventId}/faces`)
      .then((body) => {
        if (!ignore) setData(body);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, [eventId]);

  // Nothing until we know: no flash of a section that may be hidden.
  if (!data || !data.enabled) return null;

  if (data.faces.length === 0) {
    if (data.status === "COMPLETED") {
      return <p className="mt-4 text-xs text-muted">{Messages.noFacesDetected}</p>;
    }
    if (data.status === "PENDING" || data.status === "PROCESSING") {
      return <p className="mt-4 text-xs text-muted">{Messages.faceProcessingPending}</p>;
    }
    return null;
  }

  return (
    <section className="mt-5" aria-label="Detected faces">
      <h3 className="text-sm font-semibold">Face Detection</h3>
      <p className="mt-1 text-xs text-muted">
        {data.faces.length} {data.faces.length === 1 ? "face" : "faces"} detected
      </p>
      <ul className="mt-2 flex flex-wrap gap-3">
        {data.faces.map((face) => (
          <li key={face.id} className="w-28">
            <div className="aspect-square w-full overflow-hidden rounded-lg border border-line bg-black">
              {face.hasCrop ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/faces/${face.id}/image`}
                  alt="Detected face"
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-muted">
                  {Messages.faceImageUnavailable}
                </span>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted">
              Confidence: {formatFaceConfidence(face.confidence)}
            </p>
            <p className="text-[11px] text-muted">{faceAssignmentLabel(face.personId)}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
