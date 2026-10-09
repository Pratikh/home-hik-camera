import { describe, expect, it } from "vitest";
import { dedupeKey } from "@/lib/events";
import { memoryEventStore, type EventStore, type NewEvent } from "@/server/events/event-store";

/**
 * Detected-face storage and the query surface behind `/api/faces`.
 *
 * The worker owns every write, so these tests insert rows the same way the
 * worker does — raw SQL against the shared schema — and then read them back
 * through the store API the routes use.
 */

const FACE_ONE = "face_111111111111111111111111";
const FACE_TWO = "face_222222222222222222222222";
const FACE_THREE = "face_333333333333333333333333";
const EVENT_OLD = "evt_oldoldoldoldoldoldoldold";
const EVENT_NEW = "evt_newnewnewnewnewnewnewnew";

function event(overrides: Partial<NewEvent> = {}): NewEvent {
  const timestamp = overrides.timestamp ?? "2026-10-09T10:00:00+05:30";
  return {
    id: "evt_aaaaaaaaaaaaaaaaaaaaaaaa",
    dedupeKey: dedupeKey({
      cameraId: overrides.cameraId ?? 1,
      type: overrides.type ?? "motion",
      timestamp,
      classification: overrides.classification ?? "person",
    }),
    cameraId: 1,
    type: "motion",
    classification: "person",
    timestamp,
    endTimestamp: null,
    source: "hikvision",
    metaId: "log.hikvision.com/Alarm/motionStart/1",
    ...overrides,
  };
}

function insertFace(
  store: EventStore,
  face: {
    id: string;
    eventId: string;
    confidence: number;
    detectionIndex?: number;
    cropPath?: string | null;
    personId?: string | null;
    createdAt?: string;
  },
): void {
  store.db
    .prepare(
      `INSERT INTO event_faces
        (id, event_id, person_id, confidence, x, y, width, height, crop_path, detector, model,
         detection_index, created_at)
       VALUES (?, ?, ?, ?, 10, 20, 30, 40, ?, 'yunet', 'face_detection_yunet_2023mar', ?, ?)`,
    )
    .run(
      face.id,
      face.eventId,
      face.personId ?? null,
      face.confidence,
      face.cropPath === undefined ? `2026/10/${face.eventId}-face-${(face.detectionIndex ?? 0) + 1}.jpg` : face.cropPath,
      face.detectionIndex ?? 0,
      face.createdAt ?? "2026-10-09T10:00:05+05:30",
    );
}

function seedTwoEvents(store: EventStore): void {
  store.insertEvent(
    event({ id: EVENT_OLD, timestamp: "2026-09-01T10:00:00+05:30", cameraId: 1, dedupeKey: "old" }),
  );
  store.insertEvent(
    event({ id: EVENT_NEW, timestamp: "2026-10-09T10:00:00+05:30", cameraId: 2, dedupeKey: "new" }),
  );
}

const ALL = { start: null, end: null, assigned: null, minConfidence: null, eventId: null, page: 1, pageSize: 10 };

describe("FACE-004 detected face metadata", () => {
  it("returns the face joined to its event and marked Unassigned", () => {
    const store = memoryEventStore();
    seedTwoEvents(store);
    insertFace(store, { id: FACE_ONE, eventId: EVENT_NEW, confidence: 0.94, cropPath: "2026/10/x-face-1.jpg" });

    const face = store.faceById(FACE_ONE);
    expect(face).not.toBeNull();
    expect(face!.eventId).toBe(EVENT_NEW);
    // Detection only: no identity is computed, so this is Unassigned.
    expect(face!.personId).toBeNull();
    expect(face!.confidence).toBeCloseTo(0.94);
    expect(face!.cameraId).toBe(2);
    expect(face!.eventTimestamp).toBe("2026-10-09T10:00:00+05:30");
    expect(face!.eventType).toBe("motion");
    expect(face!.eventClassification).toBe("person");
    expect(face!.detector).toBe("yunet");
    expect(face!.model).toBe("face_detection_yunet_2023mar");
    expect(face!.hasCrop).toBe(true);
    // The response shape never exposes a filesystem path.
    expect(Object.keys(face!)).not.toContain("cropPath");
    expect(JSON.stringify(face)).not.toContain("face-crops");
  });

  it("reports a face with no crop as having no image", () => {
    const store = memoryEventStore();
    seedTwoEvents(store);
    insertFace(store, { id: FACE_TWO, eventId: EVENT_NEW, confidence: 0.7, cropPath: null });
    expect(store.faceById(FACE_TWO)!.hasCrop).toBe(false);
  });

  it("refuses a face id that is not the generated shape", () => {
    const store = memoryEventStore();
    expect(store.faceById("../../etc/passwd")).toBeNull();
    expect(store.faceById("face_short")).toBeNull();
    expect(store.faceById(FACE_ONE)).toBeNull();
  });
});

describe("FACE-005 / FACE-006 / FACE-007 listing", () => {
  function seeded(): EventStore {
    const store = memoryEventStore();
    seedTwoEvents(store);
    insertFace(store, { id: FACE_ONE, eventId: EVENT_NEW, confidence: 0.95, detectionIndex: 0 });
    insertFace(store, { id: FACE_TWO, eventId: EVENT_NEW, confidence: 0.81, detectionIndex: 1 });
    insertFace(store, { id: FACE_THREE, eventId: EVENT_OLD, confidence: 0.62, detectionIndex: 0 });
    return store;
  }

  it("FACE-005 returns every face for an event, strongest first", () => {
    const store = seeded();
    const faces = store.facesForEvent(EVENT_NEW);
    expect(faces.map((face) => face.id)).toEqual([FACE_ONE, FACE_TWO]);
  });

  it("lists faces newest event first and paginates", () => {
    const store = seeded();
    const all = store.faces({ ...ALL, cameraId: null });
    expect(all.total).toBe(3);
    expect(all.faces.map((face) => face.id)).toEqual([FACE_ONE, FACE_TWO, FACE_THREE]);

    const firstPage = store.faces({ ...ALL, cameraId: null, pageSize: 2 });
    expect(firstPage.faces).toHaveLength(2);
    expect(firstPage.total).toBe(3);
    const secondPage = store.faces({ ...ALL, cameraId: null, page: 2, pageSize: 2 });
    expect(secondPage.faces.map((face) => face.id)).toEqual([FACE_THREE]);
  });

  it("FACE-006 filters by minimum confidence", () => {
    const store = seeded();
    const confident = store.faces({ ...ALL, cameraId: null, minConfidence: 0.8 });
    expect(confident.faces.map((face) => face.id)).toEqual([FACE_ONE, FACE_TWO]);
    const strict = store.faces({ ...ALL, cameraId: null, minConfidence: 0.9 });
    expect(strict.faces.map((face) => face.id)).toEqual([FACE_ONE]);
  });

  it("filters by camera, by date and by event", () => {
    const store = seeded();
    expect(
      store.faces({ ...ALL, cameraId: 2 }).total,
    ).toBe(2);
    expect(
      store.faces({ ...ALL, cameraId: 1 }).total,
    ).toBe(1);

    const september = store.faces({
      ...ALL,
      cameraId: null,
      start: "2026-09-01T00:00:00+05:30",
      end: "2026-09-30T23:59:59+05:30",
    });
    expect(september.faces.map((face) => face.id)).toEqual([FACE_THREE]);

    expect(
      store.faces({ ...ALL, cameraId: null, eventId: EVENT_NEW }).total,
    ).toBe(2);
  });

  it("filters by assignment, and Assigned works once a person exists", () => {
    const store = seeded();
    store.db
      .prepare("INSERT INTO people (id, name, created_at, updated_at) VALUES ('person_1', 'Reference person', ?, ?)")
      .run("2026-10-09T10:00:00+05:30", "2026-10-09T10:00:00+05:30");
    store.db.prepare("UPDATE event_faces SET person_id = 'person_1' WHERE id = ?").run(FACE_TWO);

    const unassigned = store.faces({ ...ALL, cameraId: null, assigned: false });
    expect(unassigned.faces.map((face) => face.id)).toEqual([FACE_ONE, FACE_THREE]);

    const assigned = store.faces({ ...ALL, cameraId: null, assigned: true });
    expect(assigned.faces.map((face) => face.id)).toEqual([FACE_TWO]);
    expect(assigned.faces[0]!.personId).toBe("person_1");
  });

  it("counts detection jobs for the page summary", () => {
    const store = memoryEventStore();
    seedTwoEvents(store);
    const now = "2026-10-09T10:00:00+05:30";
    store.db
      .prepare("INSERT INTO face_processing (event_id, status, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(EVENT_NEW, "COMPLETED", now, now);
    store.db
      .prepare("INSERT INTO face_processing (event_id, status, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .run(EVENT_OLD, "PENDING", now, now);

    expect(store.faceProcessingSummary()).toEqual({ pending: 1, processing: 0, completed: 1, failed: 0 });
    expect(store.faceProcessing(EVENT_NEW)?.facesFound).toBe(0);
  });
});

describe("FACE-017 / FACE-018 relationships and cascade", () => {
  it("FACE-017 a face cannot reference a missing event", () => {
    const store = memoryEventStore();
    expect(() =>
      insertFace(store, { id: FACE_ONE, eventId: EVENT_NEW, confidence: 0.9 }),
    ).toThrow();
  });

  it("FACE-018 deleting an event cascades its faces and its job row", () => {
    const store = memoryEventStore();
    seedTwoEvents(store);
    insertFace(store, { id: FACE_ONE, eventId: EVENT_NEW, confidence: 0.9 });
    insertFace(store, { id: FACE_TWO, eventId: EVENT_NEW, confidence: 0.8, detectionIndex: 1 });
    insertFace(store, { id: FACE_THREE, eventId: EVENT_OLD, confidence: 0.6 });
    store.db
      .prepare("INSERT INTO face_processing (event_id, status, created_at, updated_at) VALUES (?, 'COMPLETED', ?, ?)")
      .run(EVENT_NEW, "2026-10-09T10:00:00+05:30", "2026-10-09T10:00:00+05:30");

    expect(store.deleteOlderThan("2026-10-01T00:00:00+05:30")).toBe(1);

    expect(store.faceById(FACE_THREE)).toBeNull();
    expect(store.faceProcessing(EVENT_OLD)).toBeNull();
    // The newer event and its faces are untouched.
    expect(store.faceById(FACE_ONE)).not.toBeNull();
    expect(store.faceById(FACE_TWO)).not.toBeNull();
    expect(store.faceProcessing(EVENT_NEW)).not.toBeNull();
  });

  it("reports the crop paths of the events retention is about to delete", () => {
    const store = memoryEventStore();
    seedTwoEvents(store);
    insertFace(store, { id: FACE_ONE, eventId: EVENT_NEW, confidence: 0.9, cropPath: "2026/10/new-face-1.jpg" });
    insertFace(store, { id: FACE_THREE, eventId: EVENT_OLD, confidence: 0.6, cropPath: "2026/09/old-face-1.jpg" });

    expect(store.faceCropPathsBefore("2026-10-01T00:00:00+05:30")).toEqual(["2026/09/old-face-1.jpg"]);
    expect(store.allFaceCropPaths().sort()).toEqual(["2026/09/old-face-1.jpg", "2026/10/new-face-1.jpg"]);
  });

  it("stores one face per detection index, so re-processing cannot duplicate", () => {
    const store = memoryEventStore();
    seedTwoEvents(store);
    insertFace(store, { id: FACE_ONE, eventId: EVENT_NEW, confidence: 0.9, detectionIndex: 0 });
    expect(() =>
      insertFace(store, { id: FACE_TWO, eventId: EVENT_NEW, confidence: 0.8, detectionIndex: 0 }),
    ).toThrow();
  });
});
