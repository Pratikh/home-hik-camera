import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Authorization contract for the V5 endpoints.
 *
 * `requireAdmin` is the single gate that rule management and the rule test
 * endpoint depend on. These tests assert the guard's decision table directly,
 * so a regression in role handling fails here rather than in a live session.
 */

const currentSession = vi.fn();

vi.mock("@/lib/auth", () => ({
  currentSession: () => currentSession(),
}));

const CONFIGURED = {
  appConfigured: true,
  appErrors: [],
  dataDir: "/tmp/v5-auth-test",
  appUsername: "home",
  appPassword: "secret",
  sessionSecret: "0123456789abcdef0123456789abcdef",
};

vi.mock("@/lib/config", () => ({
  getConfig: () => CONFIGURED,
}));

const { requireAdmin, requireUser } = await import("@/server/http/require-user");

describe("authorization", () => {
  beforeEach(() => {
    currentSession.mockReset();
  });

  it("rejects an unauthenticated caller with 401", async () => {
    currentSession.mockResolvedValue(null);
    const user = await requireUser();
    expect(user.ok).toBe(false);
    if (!user.ok) expect(user.response.status).toBe(401);

    const admin = await requireAdmin();
    expect(admin.ok).toBe(false);
    if (!admin.ok) expect(admin.response.status).toBe(401);
  });

  it("rejects a VIEWER from admin-only actions with 403", async () => {
    currentSession.mockResolvedValue({ username: "viewer", role: "VIEWER", userId: "u2", sessionId: "s2" });
    const admin = await requireAdmin();
    expect(admin.ok).toBe(false);
    if (!admin.ok) expect(admin.response.status).toBe(403);
  });

  it("allows an ADMIN through both guards", async () => {
    currentSession.mockResolvedValue({ username: "admin", role: "ADMIN", userId: "u1", sessionId: "s1" });
    const user = await requireUser();
    const admin = await requireAdmin();
    expect(user.ok).toBe(true);
    expect(admin.ok).toBe(true);
    if (admin.ok) expect(admin.role).toBe("ADMIN");
  });

  it("allows a VIEWER to read events but not to manage rules", async () => {
    currentSession.mockResolvedValue({ username: "viewer", role: "VIEWER", userId: "u2", sessionId: "s2" });
    expect((await requireUser()).ok).toBe(true);
    expect((await requireAdmin()).ok).toBe(false);
  });

  it("returns 500 when the application itself is not configured", async () => {
    currentSession.mockResolvedValue({ username: "admin", role: "ADMIN", userId: "u1", sessionId: "s1" });
    const configured = CONFIGURED.appConfigured;
    CONFIGURED.appConfigured = false;
    const user = await requireUser();
    expect(user.ok).toBe(false);
    if (!user.ok) expect(user.response.status).toBe(500);
    CONFIGURED.appConfigured = configured;
  });
});
