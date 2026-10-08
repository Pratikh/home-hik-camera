import { describe, expect, it } from "vitest";
import { buildHealth } from "@/server/health";

describe("health", () => {
  it("returns the public shape and collapses auth failure", async () => {
    const report = await buildHealth({
      appConfigured: true,
      loadDvr: async () => "auth_failed",
      loadGateway: async () => "connected",
    });
    expect(report.httpStatus).toBe(200);
    expect(report.body).toEqual({
      application: "ok",
      dvr: "disconnected",
      videoGateway: "connected",
      database: "ok",
      mediamtx: "ok",
      events: "ok",
    });
  });

  it("stays up when the DVR is offline and reports a bad app configuration", async () => {
    const offline = await buildHealth({
      appConfigured: true,
      loadDvr: async () => "not_configured",
      loadGateway: async () => "disconnected",
    });
    expect(offline.body.dvr).toBe("not_configured");
    expect(offline.body.videoGateway).toBe("disconnected");
    const broken = await buildHealth({
      appConfigured: false,
      loadDvr: async () => {
        throw new Error("secret-value-should-not-leak");
      },
      loadGateway: async () => "connected",
    });
    expect(broken.httpStatus).toBe(503);
    expect(broken.body.application).toBe("misconfigured");
    expect(JSON.stringify(broken.body)).not.toContain("secret-value-should-not-leak");
  });
});
