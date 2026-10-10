import { describe, expect, it, vi } from "vitest";
import type { CctvEvent } from "@/lib/events";

/**
 * The browser delivery link for the temporary face notification.
 *
 * The notifier publishes through the existing in-memory hub; this proves the
 * existing server-sent event route forwards a `face` payload unchanged, so no
 * second delivery mechanism was introduced.
 */

vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => ({ ok: true, username: "home", role: "ADMIN", userId: "u1", sessionId: "s1" }),
}));

vi.mock("@/server/events/event-processor", () => ({
  ensureEventProcessor: () => undefined,
  eventIngestionStatus: () => ({ running: false, lastPoll: null, lastError: null }),
}));

const { GET } = await import("@/app/api/events/stream/route");
const { publishLiveEvent } = await import("@/server/events/event-hub");

const EVENT: CctvEvent = {
  id: "evt_aaaaaaaaaaaaaaaaaaaaaaaa",
  cameraId: 1,
  type: "motion",
  classification: "person",
  timestamp: "2026-10-10T09:59:00+05:30",
  endTimestamp: "2026-10-10T09:59:07+05:30",
  confidence: null,
  hasSnapshot: true,
  recordingStart: null,
  recordingEnd: null,
  source: "hikvision",
  priority: "HIGH",
  notified: true,
  readAt: null,
};

describe("GET /api/events/stream", () => {
  it("forwards a face notification payload to the browser", async () => {
    const response = await GET();
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();

    // The stream opens with a status frame.
    const opening = decoder.decode((await reader.read()).value);
    expect(opening).toContain("event: status");

    publishLiveEvent({
      notify: true,
      event: { ...EVENT, cameraName: "Parking" },
      face: { eventId: EVENT.id, cameraId: 1, cameraName: "Parking", faces: 2, maxConfidence: 0.91 },
    });

    const frame = decoder.decode((await reader.read()).value);
    expect(frame.startsWith("data: ")).toBe(true);
    const payload = JSON.parse(frame.slice("data: ".length)) as Record<string, unknown>;
    expect(payload.notify).toBe(true);
    expect(payload.face).toEqual({
      eventId: EVENT.id,
      cameraId: 1,
      cameraName: "Parking",
      faces: 2,
      maxConfidence: 0.91,
    });
    // Nothing private travels to the browser: no crop path, no image bytes.
    expect(frame).not.toContain("face-crops");
    expect(frame).not.toContain(".jpg");
    expect(frame).not.toContain("confidence!==undefined");

    await reader.cancel();
  });

  it("still forwards an ordinary event notification unchanged", async () => {
    const response = await GET();
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    await reader.read();

    publishLiveEvent({ notify: true, event: { ...EVENT, cameraName: "Parking" } });

    const frame = decoder.decode((await reader.read()).value);
    const payload = JSON.parse(frame.slice("data: ".length)) as Record<string, unknown>;
    expect(payload.notify).toBe(true);
    expect(payload.face).toBeUndefined();
    expect((payload.event as CctvEvent).id).toBe(EVENT.id);

    await reader.cancel();
  });
});
