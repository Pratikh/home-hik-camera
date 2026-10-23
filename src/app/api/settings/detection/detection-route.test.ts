import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";

/**
 * /api/settings/detection — ADMIN-only read/write of the object-detection
 * configuration. Invalid input must never be partially stored.
 */

const state = { dataDir: "" };
const currentUser = vi.fn();

vi.mock("@/lib/config", () => ({ getConfig: () => ({ dataDir: state.dataDir }) }));

vi.mock("@/server/http/require-user", () => ({
  requireAdmin: async () => {
    const user = currentUser() as { username: string; role: string; userId: string; sessionId: string } | null;
    if (!user) {
      return { ok: false as const, response: NextResponse.json({ error: "Authentication failed" }, { status: 401 }) };
    }
    if (user.role !== "ADMIN") {
      return { ok: false as const, response: NextResponse.json({ error: "Authentication failed" }, { status: 403 }) };
    }
    return { ok: true as const, ...user };
  },
}));

const { GET, PUT } = await import("@/app/api/settings/detection/route");
const { readObjectDetectionConfig } = await import("@/server/detection/settings-store");
const { openEventStore } = await import("@/server/events/event-store");

const ADMIN = { username: "home", role: "ADMIN", userId: "u1", sessionId: "s1" };

function req(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/settings/detection", {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  state.dataDir = mkdtempSync(path.join(os.tmpdir(), "detection-route-"));
  currentUser.mockReset();
  currentUser.mockReturnValue(ADMIN);
});

afterEach(() => {
  rmSync(state.dataDir, { recursive: true, force: true });
});

describe("GET /api/settings/detection", () => {
  it("returns the safe defaults, the model and the three source modes", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect((body.settings as { enabled: boolean }).enabled).toBe(false);
    expect((body.cameras as unknown[]).length).toBe(4);
    expect((body.detectionSources as unknown[]).length).toBe(3);
    expect((body.model as { name: string }).name).toBe("YOLOX-Nano");
    expect(body.worker).toBeNull();
    expect(body.workerFresh).toBe(false);
  });

  it("refuses an unauthenticated caller", async () => {
    currentUser.mockReturnValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
  });

  it("refuses a VIEWER", async () => {
    currentUser.mockReturnValue({ ...ADMIN, role: "VIEWER" });
    const response = await GET();
    expect(response.status).toBe(403);
  });
});

describe("PUT /api/settings/detection", () => {
  it("persists a valid configuration", async () => {
    const response = await PUT(
      req("PUT", {
        settings: {
          enabled: true,
          personEnabled: true,
          personConfidence: 0.73,
          vehicleEnabled: true,
          vehicleConfidence: 0.8,
          baseFps: 1,
          activeFps: 3,
          maxFps: 5,
          motionBoost: true,
          activityTimeoutSeconds: 10,
          disappearanceThresholdSeconds: 3,
          maxConcurrentInference: 1,
          queueSize: 2,
          minimumEventDurationSeconds: 0,
          detectionSource: "ai_only",
        },
        cameras: [
          { cameraId: 1, enabled: true, personEnabled: true, personConfidence: null, vehicleEnabled: true, vehicleConfidence: null },
          { cameraId: 2, enabled: true, personEnabled: true, personConfidence: 0.85, vehicleEnabled: false, vehicleConfidence: null },
        ],
      }),
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as { settings: { enabled: boolean; personConfidence: number } };
    expect(body.settings.enabled).toBe(true);
    expect(body.settings.personConfidence).toBe(0.73);

    // Persisted, not just echoed.
    const stored = readObjectDetectionConfig(openEventStore(state.dataDir).db);
    expect(stored.settings.personConfidence).toBe(0.73);
    expect(stored.cameras.find((camera) => camera.cameraId === 2)?.personConfidence).toBe(0.85);
    // Cameras the request did not mention keep their rows.
    expect(stored.cameras.find((camera) => camera.cameraId === 3)?.enabled).toBe(false);
  });

  it("rejects an out-of-range confidence and stores nothing", async () => {
    const response = await PUT(
      req("PUT", {
        settings: { enabled: true, personConfidence: 1.5 },
        cameras: [],
      }),
    );
    expect(response.status).toBe(400);
    expect(((await response.json()) as { errors: string[] }).errors.join(" ")).toContain("personConfidence");
    expect(readObjectDetectionConfig(openEventStore(state.dataDir).db).settings.enabled).toBe(false);
  });

  it("rejects an unknown camera and stores nothing", async () => {
    const response = await PUT(
      req("PUT", {
        settings: { enabled: true },
        cameras: [{ cameraId: 9, enabled: true }],
      }),
    );
    expect(response.status).toBe(400);
    expect(readObjectDetectionConfig(openEventStore(state.dataDir).db).settings.enabled).toBe(false);
  });

  it("rejects an unknown detection source", async () => {
    const response = await PUT(req("PUT", { settings: { detectionSource: "both" }, cameras: [] }));
    expect(response.status).toBe(400);
  });

  it("rejects invalid JSON without writing", async () => {
    const request = new Request("http://localhost/api/settings/detection", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    const response = await PUT(request);
    expect(response.status).toBe(400);
  });

  it("refuses a VIEWER", async () => {
    currentUser.mockReturnValue({ ...ADMIN, role: "VIEWER" });
    const response = await PUT(req("PUT", { settings: { enabled: true }, cameras: [] }));
    expect(response.status).toBe(403);
  });
});
