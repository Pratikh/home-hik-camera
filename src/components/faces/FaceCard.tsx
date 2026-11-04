"use client";

import Link from "next/link";
import type { DetectedFace } from "@/lib/faces";
import { faceAssignmentLabel, formatFaceConfidence } from "@/lib/faces";
import { Messages } from "@/lib/messages";
import { formatKolkataDateTimeFromIso } from "@/lib/time-kolkata";
import { Icon } from "@/components/ui/Icon";

/**
 * One detected face in the gallery.
 *
 * The crop is requested from the authenticated API, never from a static path,
 * so a face image can only be read with a valid session.
 *
 * This is the only `<article>` the /faces route may render: the QA suite counts
 * articles to know how many cards are on screen, so nothing else on that page
 * (stats, notices, skeletons, pagination) may use the element.
 */
export function FaceCard({ face, cameraName }: { face: DetectedFace; cameraName: string }) {
  const confidence = formatFaceConfidence(face.confidence);

  return (
    <article className="face-card">
      <div className="face-card__img">
        {face.hasCrop ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/faces/${face.id}/image`}
            alt={`Detected face from ${cameraName}`}
            loading="lazy"
            /* The stored crop is already tight around the face: contain, never crop twice. */
            style={{ objectFit: "contain" }}
          />
        ) : (
          <div
            style={{
              display: "grid",
              placeItems: "center",
              alignContent: "center",
              gap: 8,
              height: "100%",
              padding: "0 14px",
              textAlign: "center",
              color: "var(--faint)",
              background: "radial-gradient(circle at 50% 42%, #101720 0%, #05080b 70%)",
            }}
          >
            <Icon name="faces" className="icon icon-lg" />
            <span style={{ fontSize: "var(--fs-11)" }}>{Messages.faceImageUnavailable}</span>
          </div>
        )}
        <span
          className="face-card__conf badge badge--mono"
          style={{ background: "rgba(4, 9, 12, 0.78)", borderColor: "rgba(255, 255, 255, 0.18)", color: "#e9f0f8" }}
        >
          {confidence}
        </span>
      </div>
      <div className="face-card__body">
        <div className="face-card__row">
          <span className="face-card__name">{faceAssignmentLabel(face.personId)}</span>
          <span className="face-card__time">{confidence} confidence</span>
        </div>
        <div className="face-card__meta">{cameraName}</div>
        <time className="face-card__time" dateTime={face.eventTimestamp}>
          {formatKolkataDateTimeFromIso(face.eventTimestamp)}
        </time>
        <Link
          href={`/events/${face.eventId}`}
          className="face-card__link"
          style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
        >
          View event
          <Icon name="arrowRight" className="icon icon-sm" />
        </Link>
      </div>
    </article>
  );
}
