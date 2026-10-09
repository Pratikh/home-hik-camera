import type { EventClassification, EventType } from "@/lib/events";
import { dayRangeIso } from "@/lib/events";
import { CAMERA_IDS } from "@/lib/cameras";
import { isCalendarDate } from "@/lib/time-kolkata";

/**
 * Face DETECTION model, shared by the server, the API and the browser.
 *
 * This phase records that a face exists and where it is. It deliberately has no
 * notion of identity: `personId` is null for every row, and nothing in this file
 * performs recognition, embedding or matching. The `people` table and
 * `person_id` column exist so a later phase can assign a person without a
 * schema migration.
 *
 * Terminology: a detected face with no person is "Unassigned". It is never
 * called an "unknown person", which would imply an identity.
 */

/** Face ids are generated server-side by the face worker. */
export const FACE_ID_PATTERN = /^face_[a-f0-9]{24}$/;

export const FACE_PROCESSING_STATES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;
export type FaceProcessingState = (typeof FACE_PROCESSING_STATES)[number];

export const FACE_LABEL_UNASSIGNED = "Unassigned";

export const DEFAULT_FACE_PAGE_SIZE = 24;
export const MAX_FACE_PAGE_SIZE = 60;
export const MIN_FACE_PAGE_SIZE = 1;

/** Result of phase one: a location, a confidence and no identity. */
export type DetectedFace = {
  id: string;
  eventId: string;
  /** Always null in this phase. Reserved for the future people model. */
  personId: string | null;
  confidence: number;
  x: number;
  y: number;
  width: number;
  height: number;
  hasCrop: boolean;
  detector: string;
  model: string | null;
  createdAt: string;
  /** Event fields joined in so a card needs no second request. */
  cameraId: number;
  eventTimestamp: string;
  eventType: EventType;
  eventClassification: EventClassification | null;
};

/** Everything the event-detail panel needs. */
export type FaceDetectionInfo = Pick<
  DetectedFace,
  "id" | "eventId" | "personId" | "confidence" | "x" | "y" | "width" | "height" | "hasCrop"
>;

export type FaceProcessingSummary = {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
};

export type FaceListResponse = {
  /** False when FACE_DETECTION_ENABLED is not true. */
  enabled: boolean;
  faces: DetectedFace[];
  total: number;
  page: number;
  pageSize: number;
  /** How many event snapshots are queued or done, so the page can say so. */
  processing: FaceProcessingSummary;
};

export type EventFacesResponse = {
  enabled: boolean;
  eventId: string;
  /** NONE means the event has no snapshot, so detection never ran. */
  status: FaceProcessingState | "NONE";
  faces: FaceDetectionInfo[];
};

export type FaceQuery = {
  cameraId: number | null;
  /** Inclusive ISO timestamp bounds for the event, or null for all time. */
  start: string | null;
  end: string | null;
  /** true = has a person, false = Unassigned, null = both. */
  assigned: boolean | null;
  minConfidence: number | null;
  eventId: string | null;
  page: number;
  pageSize: number;
};

export function isFaceId(value: string): boolean {
  return FACE_ID_PATTERN.test(value);
}

/**
 * Assignment state. This is not an identity: an unassigned face is simply one
 * that no person has been associated with yet.
 */
export function faceAssignmentLabel(personId: string | null): string {
  return personId ? "Assigned" : FACE_LABEL_UNASSIGNED;
}

export function formatFaceConfidence(confidence: number): string {
  if (!Number.isFinite(confidence)) return "—";
  return `${Math.round(Math.min(1, Math.max(0, confidence)) * 100)}%`;
}

function triState(value: string | null | undefined): boolean | null {
  if (value === "true" || value === "1") return true;
  if (value === "false" || value === "0") return false;
  return null;
}

/**
 * Validate the `/api/faces` query string. Any malformed filter is rejected with
 * a message rather than silently ignored, matching the events API.
 */
export function parseFaceListQuery(input: {
  camera: string | null;
  date: string | null;
  assigned: string | null;
  minConfidence: string | null;
  eventId: string | null;
  page: string | null;
  pageSize: string | null;
}): { ok: true; query: FaceQuery } | { ok: false; message: string } {
  const camera = input.camera;
  let cameraId: number | null = null;
  if (camera && camera !== "all") {
    const parsed = Number(camera);
    if (!Number.isInteger(parsed) || !CAMERA_IDS.includes(parsed)) {
      return { ok: false, message: "Invalid camera" };
    }
    cameraId = parsed;
  }

  let start: string | null = null;
  let end: string | null = null;
  const date = (input.date ?? "").trim();
  if (date) {
    if (!isCalendarDate(date)) return { ok: false, message: "Invalid date" };
    const range = dayRangeIso(date, "00:00", "23:59");
    if (!range) return { ok: false, message: "Invalid date" };
    start = range.start;
    end = range.end;
  }

  const assigned = triState(input.assigned);

  let minConfidence: number | null = null;
  const rawConfidence = (input.minConfidence ?? "").trim();
  if (rawConfidence) {
    const parsed = Number(rawConfidence);
    if (!Number.isFinite(parsed) || parsed < 0 || parsed > 1) {
      return { ok: false, message: "Invalid confidence" };
    }
    minConfidence = parsed;
  }

  const eventId = (input.eventId ?? "").trim() || null;
  if (eventId && !/^evt_[a-f0-9]{24}$/.test(eventId)) {
    return { ok: false, message: "Invalid event" };
  }

  const page = Number(input.page ?? "1");
  const pageSize = Number(input.pageSize ?? String(DEFAULT_FACE_PAGE_SIZE));
  if (!Number.isInteger(page) || page < 1 || page > 10_000) {
    return { ok: false, message: "Invalid page" };
  }
  if (!Number.isInteger(pageSize) || pageSize < MIN_FACE_PAGE_SIZE || pageSize > MAX_FACE_PAGE_SIZE) {
    return { ok: false, message: "Invalid page size" };
  }

  return {
    ok: true,
    query: { cameraId, start, end, assigned, minConfidence, eventId, page, pageSize },
  };
}
