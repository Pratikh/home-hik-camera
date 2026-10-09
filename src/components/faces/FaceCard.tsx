"use client";

import Link from "next/link";
import type { DetectedFace } from "@/lib/faces";
import { faceAssignmentLabel, formatFaceConfidence } from "@/lib/faces";
import { Messages } from "@/lib/messages";
import { formatKolkataDateTimeFromIso } from "@/lib/time-kolkata";

/**
 * One detected face.
 *
 * The crop is requested from the authenticated API, never from a static path,
 * so a face image can only be read with a valid session.
 */
export function FaceCard({ face, cameraName }: { face: DetectedFace; cameraName: string }) {
  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-card">
      <div className="relative aspect-square w-full bg-black">
        {face.hasCrop ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/faces/${face.id}/image`}
            alt={`Detected face from ${cameraName}`}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <p className="flex h-full w-full items-center justify-center px-3 text-center text-xs text-muted">
            {Messages.faceImageUnavailable}
          </p>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-1 p-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{faceAssignmentLabel(face.personId)}</span>
          <span className="shrink-0 text-xs text-muted">{formatFaceConfidence(face.confidence)} confidence</span>
        </div>
        <p className="truncate text-xs text-muted">{cameraName}</p>
        <time dateTime={face.eventTimestamp} className="font-mono text-xs text-muted">
          {formatKolkataDateTimeFromIso(face.eventTimestamp)}
        </time>
        <Link href={`/events/${face.eventId}`} className="mt-1 inline-block text-xs text-teal">
          View event
        </Link>
      </div>
    </article>
  );
}
