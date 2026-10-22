import { beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { legacyRuleFields, type NotificationRule } from "@/lib/events";

const CONFIG = { dataDir: "" };
vi.mock("@/lib/config", () => ({ getConfig: () => CONFIG }));
vi.mock("@/server/http/require-user", () => ({
  requireAdmin: async () => ({ ok: true as const, username: "admin", role: "ADMIN", userId: "u1", sessionId: "s1" }),
}));

const { POST } = await import("@/app/api/notifications/test/route");
const { openEventStore } = await import("@/server/events/event-store");

function rule(cameraIds: number[], eventTypes: NotificationRule["eventTypes"]): NotificationRule {
  const fallback: NotificationRule = {
    id: "rule-multi",
    name: "Multi",
    enabled: true,
    cameraId: null,
    eventType: "motion",
    classification: "person",
    minimumPriority: null,
    scheduleStart: null,
    scheduleEnd: null,
    daysOfWeek: [],
    quietHoursStart: null,
    quietHoursEnd: null,
    quietHoursBehavior: "suppress",
    cooldownSeconds: 300,
  };
  return {
    ...fallback,
    cameraIds,
    eventTypes,
    ...legacyRuleFields({ cameraIds, eventTypes: eventTypes ?? [], fallback }),
  };
}

function post(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/notifications/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  CONFIG.dataDir = mkdtempSync(path.join(os.tmpdir(), "rule-dryrun-"));
  const store = openEventStore(CONFIG.dataDir);
  // The seeded defaults would otherwise match the same events and hide a
  // camera/event mismatch in this isolated dry-run test.
  for (const seeded of store.rules()) store.deleteRule(seeded.id);
  store.saveRule(rule([1, 2], ["person", "vehicle"]));
});

describe("notification dry-run", () => {
  it("reports a match for every selected camera/event combination", async () => {
    for (const cameraId of [1, 2]) {
      const response = await POST(
        post({ cameraId, type: "motion", classification: "person", date: "2026-10-07", time: "10:00" }),
      );
      expect(response.status).toBe(200);
      const body = (await response.json()) as { matched: boolean; notify: boolean };
      expect(body.matched, `camera ${cameraId}`).toBe(true);
      expect(body.notify, `camera ${cameraId}`).toBe(true);
    }
    for (const cameraId of [1, 2]) {
      const response = await POST(
        post({ cameraId, type: "motion", classification: "vehicle", date: "2026-10-07", time: "10:00" }),
      );
      const body = (await response.json()) as { matched: boolean; notify: boolean };
      expect(body.matched, `camera ${cameraId} vehicle`).toBe(true);
      expect(body.notify, `camera ${cameraId} vehicle`).toBe(true);
    }
  });

  it("reports no matching rule for an unselected camera or event", async () => {
    const wrongCamera = await POST(
      post({ cameraId: 3, type: "motion", classification: "person", date: "2026-10-07", time: "10:00" }),
    );
    const cameraBody = (await wrongCamera.json()) as { matched: boolean; decisions: unknown[] };
    expect(cameraBody.matched).toBe(false);
    expect(cameraBody.decisions).toEqual([]);

    const wrongEvent = await POST(
      post({ cameraId: 1, type: "motion", classification: null, date: "2026-10-07", time: "10:00" }),
    );
    const eventBody = (await wrongEvent.json()) as { matched: boolean; decisions: unknown[] };
    expect(eventBody.matched).toBe(false);
    expect(eventBody.decisions).toEqual([]);
  });
});
