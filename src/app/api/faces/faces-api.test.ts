import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * The `/api/faces` surface.
 *
 * FACE-015 / FACE-016 live here: the crop route must refuse an unauthenticated
 * caller before it touches the disk, must never accept a filesystem path from
 * the browser, and must persist nothing when detection is off.
 */

const CONFIG = {
  appConfigured: true,
  dataDir: "",
  faceDetectionEnabled: true,
};

const currentUser = vi.fn();

vi.mock("@/lib/config", () => ({ getConfig: () => CONFIG }));

vi.mock("@/server/http/require-user", () => ({
  requireUser: async () =>
    currentUser() ?? {
      ok: false as const,
      response: NextResponse.json({ error: "Authentication failed" }, { status: 401 }),
    },
}));

const { GET: listFaces } = await import("@/app/api/faces/route");
const { GET: getFace } = await import("@/app/api/faces/[id]/route");
const { GET: getFaceImage } = await import("@/app/api/faces/[id]/image/route");
const { GET: getEventFaces } = await import("@/app/api/events/[id]/faces/route");
const { openEventStore } = await import("@/server/events/event-store");

const EVENT_ID = "evt_aaaaaaaaaaaaaaaaaaaaaaaa";
const EVENT_TWO = "evt_bbbbbbbbbbbbbbbbbbbbbbbb";
const MISSING_EVENT = "evt_ffffffffffffffffffffffff";
const FACE_ID = "face_111111111111111111111111";
const FACE_TWO = "face_222222222222222222222222";
const FACE_THREE = "face_333333333333333333333333";
const SNEAKY_FACE = "face_444444444444444444444444";
const CROP_FILE = "2026/10/evt_aaaaaaaaaaaaaaaaaaaaaaaa-face-1.jpg";

let dataDir = "";
let cropBytes: Buffer;

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function seedEvent(store: ReturnType<typeof openEventStore>, id: string, cameraId: number, timestamp: string, hasSnapshot = true) {
  store.insertEvent({
    id,
    dedupeKey: `dedupe-${id}`,
    cameraId,
    type: "motion",
    classification: "person",
    timestamp,
    endTimestamp: null,
    source: "hikvision",
    metaId: `meta-${id}`,
  });
  if (hasSnapshot) store.setSnapshotPath(id, `2026/10/${id}.jpg`);
}

function seedFace(
  store: ReturnType<typeof openEventStore>,
  id: string,
  eventId: string,
  confidence: number,
  cropPath: string | null,
  index = 0,
) {
  store.db
    .prepare(
      `INSERT INTO event_faces (id, event_id, confidence, x, y, width, height, crop_path, detector,
                                detection_index, created_at)
       VALUES (?, ?, ?, 1, 2, 30, 40, ?, 'yunet', ?, '2026-10-09T10:00:00+05:30')`,
    )
    .run(id, eventId, confidence, cropPath, index);
}

beforeEach(async () => {
  dataDir = mkdtempSync(path.join(os.tmpdir(), "face-api-"));
  CONFIG.dataDir = dataDir;
  CONFIG.faceDetectionEnabled = true;
  currentUser.mockReset();
  currentUser.mockReturnValue({ ok: true, username: "home", role: "ADMIN", userId: "u1", sessionId: "s1" });

  cropBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02, 0x03]);
  const cropFile = path.join(dataDir, "face-crops", CROP_FILE);
  await mkdir(path.dirname(cropFile), { recursive: true });
  await writeFile(cropFile, cropBytes);

  const store = openEventStore(dataDir);
  seedEvent(store, EVENT_ID, 1, "2026-10-09T10:00:00+05:30");
  seedEvent(store, EVENT_TWO, 2, "2026-10-09T11:00:00+05:30");
  seedEvent(store, MISSING_EVENT, 3, "2026-10-09T12:00:00+05:30", false);
  seedFace(store, FACE_ID, EVENT_ID, 0.95, CROP_FILE);
  seedFace(store, FACE_TWO, EVENT_ID, 0.81, null, 1);
  seedFace(store, FACE_THREE, EVENT_TWO, 0.7, null);
  store.db
    .prepare("INSERT INTO face_processing (event_id, status, faces_found, created_at, updated_at) VALUES (?, 'COMPLETED', 2, ?, ?)")
    .run(EVENT_ID, "2026-10-09T10:00:10+05:30", "2026-10-09T10:00:10+05:30");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/faces", () => {
  it("lists detected faces with event context and never a filesystem path", async () => {
    const response = await listFaces(new Request("http://localhost/api/faces?camera=all&page=1&pageSize=24"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      enabled: boolean;
      total: number;
      faces: Array<Record<string, unknown>>;
      processing: Record<string, number>;
    };
    expect(body.enabled).toBe(true);
    expect(body.total).toBe(3);
    // Newest event first, strongest detection first within an event.
    expect(body.faces.map((face) => face.id)).toEqual([FACE_THREE, FACE_ID, FACE_TWO]);
    expect(body.faces[1]).toMatchObject({
      id: FACE_ID,
      eventId: EVENT_ID,
      cameraId: 1,
      personId: null,
      hasCrop: true,
      detector: "yunet",
    });
    expect(JSON.stringify(body)).not.toContain("face-crops");
    expect(JSON.stringify(body)).not.toContain(dataDir);
    expect(body.processing).toEqual({ pending: 0, processing: 0, completed: 1, failed: 0 });
  });

  it("applies the camera, confidence and assignment filters", async () => {
    const byCamera = await listFaces(new Request("http://localhost/api/faces?camera=2"));
    expect(((await byCamera.json()) as { total: number }).total).toBe(1);

    const confident = await listFaces(new Request("http://localhost/api/faces?minConfidence=0.9"));
    expect(((await confident.json()) as { faces: Array<{ id: string }> }).faces.map((face) => face.id)).toEqual([FACE_ID]);

    const assigned = await listFaces(new Request("http://localhost/api/faces?assigned=true"));
    expect(((await assigned.json()) as { total: number }).total).toBe(0);
    const unassigned = await listFaces(new Request("http://localhost/api/faces?assigned=false"));
    expect(((await unassigned.json()) as { total: number }).total).toBe(3);
  });

  it("rejects malformed filters instead of silently ignoring them", async () => {
    for (const query of ["camera=9", "date=not-a-date", "minConfidence=5", "pageSize=999", "eventId=../etc", "page=0"]) {
      const response = await listFaces(new Request(`http://localhost/api/faces?${query}`));
      expect(response.status, query).toBe(400);
    }
  });

  it("answers 200 with enabled:false when detection is switched off, and reads nothing", async () => {
    CONFIG.faceDetectionEnabled = false;
    const response = await listFaces(new Request("http://localhost/api/faces"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { enabled: boolean; faces: unknown[]; total: number };
    expect(body).toEqual({
      enabled: false,
      faces: [],
      total: 0,
      page: 1,
      pageSize: 24,
      processing: { pending: 0, processing: 0, completed: 0, failed: 0 },
    });
  });

  it("requires a session", async () => {
    currentUser.mockReturnValue(null);
    const response = await listFaces(new Request("http://localhost/api/faces"));
    expect(response.status).toBe(401);
  });
});

describe("GET /api/faces/[id]", () => {
  it("returns one face, and 404 for an unknown or malformed id", async () => {
    const ok = await getFace(new Request("http://localhost/api/faces/x"), params(FACE_ID));
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { face: { id: string } }).face.id).toBe(FACE_ID);

    expect((await getFace(new Request("http://localhost/api/faces/x"), params("face_999999999999999999999999"))).status).toBe(404);
    expect((await getFace(new Request("http://localhost/api/faces/x"), params("../../etc/passwd"))).status).toBe(404);
  });

  it("hides the record when detection is disabled", async () => {
    CONFIG.faceDetectionEnabled = false;
    expect((await getFace(new Request("http://localhost/api/faces/x"), params(FACE_ID))).status).toBe(404);
  });
});

describe("FACE-015 / FACE-016 GET /api/faces/[id]/image", () => {
  it("FACE-015 requires a session and reads nothing without one", async () => {
    currentUser.mockReturnValue(null);
    const response = await getFaceImage(new Request("http://localhost/api/faces/x/image"), params(FACE_ID));
    expect(response.status).toBe(401);
    const body = await response.text();
    expect(body).not.toContain("\xff\xd8");
    expect(response.headers.get("content-type")).not.toContain("image/jpeg");
  });

  it("FACE-016 refuses an unknown, malformed or traversal face id", async () => {
    expect((await getFaceImage(new Request("http://localhost/api/faces/x/image"), params(FACE_TWO))).status).toBe(404);
    expect((await getFaceImage(new Request("http://localhost/api/faces/x/image"), params("face_zzz"))).status).toBe(404);
    expect(
      (await getFaceImage(new Request("http://localhost/api/faces/x/image"), params("..%2f..%2fetc%2fpasswd"))).status,
    ).toBe(404);
  });

  it("serves the stored crop as a private, uncacheable JPEG", async () => {
    const response = await getFaceImage(new Request("http://localhost/api/faces/x/image"), params(FACE_ID));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("cache-control")).toContain("private");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(cropBytes);
  });

  it("404s when the row has no crop, or the file has gone", async () => {
    expect((await getFaceImage(new Request("http://localhost/api/faces/x/image"), params(FACE_TWO))).status).toBe(404);

    const { unlink } = await import("node:fs/promises");
    await unlink(path.join(dataDir, "face-crops", CROP_FILE));
    expect((await getFaceImage(new Request("http://localhost/api/faces/x/image"), params(FACE_ID))).status).toBe(404);
  });

  it("never follows a crop path that escapes the crop directory", async () => {
    const outside = path.join(dataDir, "outside-secret.jpg");
    await writeFile(outside, "TOP SECRET");
    openEventStore(dataDir)
      .db.prepare(
        `INSERT INTO event_faces (id, event_id, confidence, x, y, width, height, crop_path, detector,
                                  detection_index, created_at)
         VALUES (?, ?, 0.9, 1, 2, 30, 40, ?, 'yunet', 9, '2026-10-09T10:00:00+05:30')`,
      )
      .run(SNEAKY_FACE, EVENT_ID, "../../outside-secret.jpg");

    const response = await getFaceImage(new Request("http://localhost/api/faces/x/image"), params(SNEAKY_FACE));
    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("TOP SECRET");
  });

  it("hides crops entirely when detection is disabled", async () => {
    CONFIG.faceDetectionEnabled = false;
    expect((await getFaceImage(new Request("http://localhost/api/faces/x/image"), params(FACE_ID))).status).toBe(404);
  });
});

describe("GET /api/events/[id]/faces", () => {
  it("reports the faces and the detection state for an event", async () => {
    const response = await getEventFaces(new Request("http://localhost/api/events/x/faces"), params(EVENT_ID));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      enabled: boolean;
      status: string;
      faces: Array<{ id: string; personId: null; hasCrop: boolean }>;
    };
    expect(body.enabled).toBe(true);
    expect(body.status).toBe("COMPLETED");
    expect(body.faces.map((face) => face.id)).toEqual([FACE_ID, FACE_TWO]);
    expect(body.faces.every((face) => face.personId === null)).toBe(true);
    expect(JSON.stringify(body)).not.toContain("face-crops");
  });

  it("distinguishes an unprocessed snapshot from an event without one", async () => {
    const noSnapshot = await getEventFaces(new Request("http://localhost/api/events/x/faces"), params(MISSING_EVENT));
    expect(((await noSnapshot.json()) as { status: string }).status).toBe("NONE");

    const { openEventStore: open } = await import("@/server/events/event-store");
    open(dataDir)
      .db.prepare(
        `INSERT INTO events (id, dedupe_key, camera_id, type, classification, timestamp, snapshot_path, source, created_at, priority)
         VALUES ('evt_cccccccccccccccccccccccc', 'cc', 1, 'motion', 'person', '2026-10-09T13:00:00+05:30', '2026/10/x.jpg', 'hikvision', '2026-10-09T13:00:00+05:30', 'NORMAL')`,
      )
      .run();
    const queued = await getEventFaces(
      new Request("http://localhost/api/events/x/faces"),
      params("evt_cccccccccccccccccccccccc"),
    );
    expect(((await queued.json()) as { status: string }).status).toBe("PENDING");
  });

  it("renders nothing but a disabled marker when detection is off", async () => {
    CONFIG.faceDetectionEnabled = false;
    const response = await getEventFaces(new Request("http://localhost/api/events/x/faces"), params(EVENT_ID));
    expect(await response.json()).toEqual({ enabled: false, eventId: EVENT_ID, status: "NONE", faces: [] });
  });

  it("404s for an unknown event and requires a session", async () => {
    expect((await getEventFaces(new Request("http://localhost/api/events/x/faces"), params(MISSING_EVENT))).status).toBe(200);
    expect((await getEventFaces(new Request("http://localhost/api/events/x/faces"), params("evt_999999999999999999999999"))).status).toBe(404);
    expect((await getEventFaces(new Request("http://localhost/api/events/x/faces"), params("not-an-event"))).status).toBe(404);

    currentUser.mockReturnValue(null);
    expect((await getEventFaces(new Request("http://localhost/api/events/x/faces"), params(EVENT_ID))).status).toBe(401);
  });
});
