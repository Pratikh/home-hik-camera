"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import type { EventFacesResponse } from "@/lib/faces";
import { faceAssignmentLabel, formatFaceConfidence } from "@/lib/faces";
import { Messages } from "@/lib/messages";
import { Icon } from "@/components/ui/Icon";

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
    const message =
      data.status === "COMPLETED"
        ? Messages.noFacesDetected
        : data.status === "PENDING" || data.status === "PROCESSING"
          ? Messages.faceProcessingPending
          : null;
    if (!message) return null;
    // A real section even when empty: a bare sentence between two cards reads
    // like a layout accident.
    return (
      <section className="card card--pad" aria-label="Detected faces">
        <div className="flex items-center gap-2">
          <Icon name="faces" className="icon icon-sm text-muted" />
          <h2 className="card__title">Face Detection</h2>
          <span className="section__hint ml-auto">{message}</span>
        </div>
      </section>
    );
  }

  const detected = `${data.faces.length} ${data.faces.length === 1 ? "face" : "faces"} detected`;

  return (
    <section className="card" aria-label="Detected faces">
      <div className="card__head">
        <h2 className="card__title">
          <Icon name="faces" className="icon icon-sm" />
          Face Detection
        </h2>
        <span className="badge badge--accent">{detected}</span>
      </div>
      <div className="card__body">
        <div className="face-strip">
          {data.faces.map((face) => (
            <div key={face.id} className="face-thumb">
              <div className="face-thumb__img">
                {face.hasCrop ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/faces/${face.id}/image`} alt="Detected face" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center px-2 text-center text-[10px] text-muted">
                    {Messages.faceImageUnavailable}
                  </span>
                )}
              </div>
              <div className="face-thumb__meta">Confidence: {formatFaceConfidence(face.confidence)}</div>
              <div className="face-thumb__meta">{faceAssignmentLabel(face.personId)}</div>
            </div>
          ))}
        </div>
        <p className="section__hint mt-3">
          Face crops stay on this hub. Identity assignment arrives in a later phase, so every face stays
          Unassigned.
        </p>
      </div>
    </section>
  );
}
