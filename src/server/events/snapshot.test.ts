import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { snapshotRelativePath } from "@/server/events/snapshot";
import { captureEventSnapshot, captureEventSnapshotForPoll } from "@/server/events/snapshot";

/**
 * The event still is captured from the DVR's live picture endpoint. These tests
 * pin the two properties the notification pipeline depends on:
 *
 * - a live event gets exactly one file at a path derived from its own
 *   camera id + event id (so concurrent events can never overwrite each other);
 * - a historical (backfilled) event is never given a "current" frame, because
 *   that frame has nothing to do with the event.
 */

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 7)]);

type FakeClient = { getBinary: (endpoint: string) => Promise<Buffer>; calls: string[] };

function fakeClient(bytes: Buffer = JPEG, fail = false): FakeClient {
  const calls: string[] = [];
  return {
    calls,
    getBinary: async (endpoint: string) => {
      calls.push(endpoint);
      if (fail) throw new Error("dvr refused");
      return bytes;
    },
  };
}

const dirs: string[] = [];
function tempDataDir(): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), "snapshot-test-"));
  dirs.push(dir);
  vi.stubEnv("DATA_DIR", dir);
  return dir;
}

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("SNAPSHOT-001 — a live event keeps its own frame", () => {
  it("writes the DVR bytes under the event's camera/date path", async () => {
    const dataDir = tempDataDir();
    const client = fakeClient();

    const stored = await captureEventSnapshot({
      cameraId: 4,
      eventId: "evt_aaaaaaaaaaaaaaaaaaaaaaaa",
      at: new Date("2026-10-23T15:23:35+05:30"),
      client: client as never,
    });

    expect(stored).toBe("2026/10/23/4-evt_aaaaaaaaaaaaaaaaaaaaaaaa.jpg");
    const file = path.join(dataDir, "events", stored!);
    expect(readFileSync(file).equals(JPEG)).toBe(true);
    expect(client.calls.length).toBe(1);
  });

  it("uses the IST calendar date even when the UTC date is different", () => {
    // 19:00Z is 00:30 IST on the next day: the DVR overlay and the event both
    // use India time, so the folder must follow it too.
    expect(snapshotRelativePath(2, "evt_bbbbbbbbbbbbbbbbbbbbbbbb", new Date("2026-10-22T19:00:00Z"))).toBe(
      "2026/10/23/2-evt_bbbbbbbbbbbbbbbbbbbbbbbb.jpg",
    );
  });

  it("gives concurrent events on one camera different files", async () => {
    const dataDir = tempDataDir();
    const client = fakeClient();
    const at = new Date("2026-10-23T15:23:35+05:30");

    const first = await captureEventSnapshot({ cameraId: 4, eventId: "evt_111111111111111111111111", at, client: client as never });
    const second = await captureEventSnapshot({ cameraId: 4, eventId: "evt_222222222222222222222222", at, client: client as never });

    expect(first).not.toBe(second);
    expect(first).toBe("2026/10/23/4-evt_111111111111111111111111.jpg");
    expect(second).toBe("2026/10/23/4-evt_222222222222222222222222.jpg");
    expect(readFileSync(path.join(dataDir, "events", first!)).equals(JPEG)).toBe(true);
    expect(readFileSync(path.join(dataDir, "events", second!)).equals(JPEG)).toBe(true);
  });

  it("rejects a non-JPEG body instead of storing a broken image", async () => {
    tempDataDir();
    const client = fakeClient(Buffer.from("<html>login</html>"));

    const stored = await captureEventSnapshot({
      cameraId: 1,
      eventId: "evt_cccccccccccccccccccccccc",
      at: new Date("2026-10-23T15:23:35+05:30"),
      client: client as never,
    });

    expect(stored).toBeNull();
  });

  it("leaves the snapshot empty when the DVR refuses", async () => {
    tempDataDir();
    const client = fakeClient(JPEG, true);

    const stored = await captureEventSnapshot({
      cameraId: 1,
      eventId: "evt_dddddddddddddddddddddddd",
      at: new Date("2026-10-23T15:23:35+05:30"),
      client: client as never,
    });

    expect(stored).toBeNull();
  });
});

describe("SNAPSHOT-002 — a backfilled event is never given a current frame", () => {
  it("does not call the DVR and stores nothing when live capture is not allowed", async () => {
    const dataDir = tempDataDir();
    const client = fakeClient();

    const stored = await captureEventSnapshot({
      cameraId: 4,
      eventId: "evt_eeeeeeeeeeeeeeeeeeeeeeee",
      at: new Date("2026-10-23T05:49:16+05:30"),
      liveAllowed: false,
      client: client as never,
    });

    expect(stored).toBeNull();
    // No network call at all: the old event never receives today's live frame.
    expect(client.calls).toEqual([]);
    expect(() => readFileSync(path.join(dataDir, "events", "2026/10/23/4-evt_eeeeeeeeeeeeeeeeeeeeeeee.jpg"))).toThrow();
  });
});

describe("SNAPSHOT-003 — only a fresh event receives a live still", () => {
  const EVENT_AT = "2026-10-23T15:23:35+05:30";

  it("captures a still for an event the normal poll just found", async () => {
    tempDataDir();
    const client = fakeClient();
    const stored = await captureEventSnapshotForPoll({
      cameraId: 4,
      eventId: "evt_ffffffffffffffffffffffff",
      at: new Date(EVENT_AT),
      eventTimestamp: EVENT_AT,
      now: new Date("2026-10-23T15:23:40+05:30"),
      client: client as never,
      backfill: false,
    });
    expect(stored).toBe("2026/10/23/4-evt_ffffffffffffffffffffffff.jpg");
    expect(client.calls.length).toBe(1);
  });

  it("tolerates the DVR clock offset for a live event", async () => {
    tempDataDir();
    const client = fakeClient();
    // The DVR clock is measured ~18 s behind the host; the event still counts
    // as live and keeps its still.
    const stored = await captureEventSnapshotForPoll({
      cameraId: 4,
      eventId: "evt_aaaaaaaaaaaaaaaabbbbbbbb",
      at: new Date(EVENT_AT),
      eventTimestamp: EVENT_AT,
      now: new Date("2026-10-23T15:23:58+05:30"),
      client: client as never,
      backfill: false,
    });
    expect(stored).toBe("2026/10/23/4-evt_aaaaaaaaaaaaaaaabbbbbbbb.jpg");
    expect(client.calls.length).toBe(1);
  });

  it("never captures a still for a backfilled event", async () => {
    tempDataDir();
    const client = fakeClient();
    const stored = await captureEventSnapshotForPoll({
      cameraId: 4,
      eventId: "evt_999999999999999999999999",
      at: new Date("2026-10-23T05:49:16+05:30"),
      eventTimestamp: "2026-10-23T05:49:16+05:30",
      now: new Date("2026-10-23T13:22:20+05:30"),
      client: client as never,
      backfill: true,
    });
    expect(stored).toBeNull();
    expect(client.calls).toEqual([]);
  });

  it("refuses a still for an event that is already too old", async () => {
    tempDataDir();
    const client = fakeClient();
    const stored = await captureEventSnapshotForPoll({
      cameraId: 4,
      eventId: "evt_777777777777777777777777",
      at: new Date("2026-10-23T15:55:36+05:30"),
      eventTimestamp: "2026-10-23T15:55:36+05:30",
      now: new Date("2026-10-23T15:57:02+05:30"),
      client: client as never,
      backfill: false,
    });
    expect(stored).toBeNull();
    // A live frame captured 86 s later is a different moment; no call is made.
    expect(client.calls).toEqual([]);
  });
});
