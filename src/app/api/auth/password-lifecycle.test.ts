import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/password-hash";

/**
 * Password lifecycle and self-service session revocation.
 *
 * The route guards are mocked at the same boundary the application uses
 * (`requireUser` / `requireAdmin`), so these tests assert the behaviour behind
 * them: hash replacement, session invalidation, validation, and the absence of
 * hashes in responses.
 */

const CONFIG = {
  appConfigured: true,
  dataDir: "",
  sessionSecret: "0123456789abcdef0123456789abcdef",
  cookieSecure: false,
};

const state = vi.hoisted(() => ({
  user: null as null | { ok: true; username: string; role: "ADMIN" | "VIEWER"; userId: string; sessionId: string },
  admin: null as null | { ok: true; username: string; role: "ADMIN"; userId: string; sessionId: string },
}));

vi.mock("@/lib/config", () => ({ getConfig: () => CONFIG }));

vi.mock("@/lib/auth", () => ({
  SESSION_MAX_AGE: 60 * 60 * 24 * 7,
  requestUsesHttps: () => false,
  sessionCookieOptions: (secure: boolean) => ({
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  }),
}));

vi.mock("@/server/http/require-user", () => ({
  requireUser: async () =>
    state.user ?? {
      ok: false as const,
      response: NextResponse.json({ error: "Authentication failed" }, { status: 401 }),
    },
  requireAdmin: async () =>
    state.admin ?? {
      ok: false as const,
      response: NextResponse.json({ error: "Authentication failed" }, { status: 403 }),
    },
}));

const { POST: changeOwnPassword } = await import("@/app/api/auth/password/route");
const { PATCH: patchUser } = await import("@/app/api/users/[id]/route");
const { GET: listOwnSessions, DELETE: revokeOwnSessions } = await import("@/app/api/auth/sessions/route");
const { DELETE: revokeUserSessions } = await import("@/app/api/users/[id]/sessions/route");
const { accountStore } = await import("@/server/auth/accounts");

function params(id: string): { params: Promise<{ id: string }> } {
  return { params: Promise.resolve({ id }) };
}

function passwordRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/auth/password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function sessionRequest(method: string, body?: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/auth/sessions", {
    method,
    headers: { "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

let accounts: ReturnType<typeof accountStore>;
let user: NonNullable<ReturnType<ReturnType<typeof accountStore>["findById"]>>;

beforeEach(() => {
  CONFIG.dataDir = mkdtempSync(path.join(os.tmpdir(), "password-lifecycle-"));
  accounts = accountStore(CONFIG.dataDir);
  user = accounts.createUser({ username: "home", password: "old-password", role: "ADMIN" })!;
  state.user = { ok: true, username: user.username, role: "ADMIN", userId: user.id, sessionId: "current-session" };
  state.admin = state.user as typeof state.admin;
});

afterEach(() => {
  state.user = null;
  state.admin = null;
});

describe("self-service password change", () => {
  it("rejects a wrong current password without changing the hash", async () => {
    const before = accounts.findById(user.id)!.passwordHash;
    const response = await changeOwnPassword(passwordRequest({ currentPassword: "wrong", newPassword: "new-password" }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Current password is incorrect." });
    expect(accounts.findById(user.id)!.passwordHash).toBe(before);
    expect(accounts.listAudit({ action: "PASSWORD_CHANGE_FAILED" }).total).toBe(1);
  });

  it("rejects a new password that fails the existing policy", async () => {
    const before = accounts.findById(user.id)!.passwordHash;
    const response = await changeOwnPassword(passwordRequest({ currentPassword: "old-password", newPassword: "short" }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: string };
    expect(body.error).toMatch(/at least 8/i);
    expect(accounts.findById(user.id)!.passwordHash).toBe(before);
  });

  it("changes the password, revokes old sessions, and issues a fresh one", async () => {
    const oldOne = accounts.createSession({
      userId: user.id,
      ip: "10.0.0.1",
      userAgent: "old-one",
      expiresAt: Date.now() + 60_000,
    });
    const oldTwo = accounts.createSession({
      userId: user.id,
      ip: "10.0.0.2",
      userAgent: "old-two",
      expiresAt: Date.now() + 60_000,
    });

    const response = await changeOwnPassword(
      passwordRequest({ currentPassword: "old-password", newPassword: "new-password" }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { ok: boolean; sessionsRevoked: number };
    expect(body.ok).toBe(true);
    expect(body.sessionsRevoked).toBe(2);

    expect(accounts.getSession(oldOne)).toBeNull();
    expect(accounts.getSession(oldTwo)).toBeNull();
    expect(verifyPassword("new-password", accounts.findById(user.id)!.passwordHash)).toBe(true);

    const active = accounts.listSessionsForUser(user.id);
    expect(active).toHaveLength(1);
    expect(active[0]!.id).not.toBe(oldOne);
    expect(response.headers.get("set-cookie")).toContain("cctv_session=");

    // The response and audit trail never carry a hash or a password.
    const serialized = JSON.stringify(body) + JSON.stringify(accounts.listAudit({ limit: 100 }));
    expect(serialized).not.toContain(accounts.findById(user.id)!.passwordHash);
    expect(serialized).not.toContain("new-password");
  });

  it("refuses an unauthenticated caller", async () => {
    state.user = null;
    const response = await changeOwnPassword(
      passwordRequest({ currentPassword: "old-password", newPassword: "new-password" }),
    );
    expect(response.status).toBe(401);
  });
});

describe("admin password reset", () => {
  it("resets another user's password and invalidates their sessions", async () => {
    const guest = accounts.createUser({ username: "guest", password: "guest-password", role: "VIEWER" })!;
    const guestSession = accounts.createSession({
      userId: guest.id,
      ip: null,
      userAgent: null,
      expiresAt: Date.now() + 60_000,
    });

    const response = await patchUser(
      new Request(`http://localhost:3000/api/users/${guest.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "reset-password" }),
      }),
      params(guest.id),
    );
    expect(response.status).toBe(200);
    expect(accounts.getSession(guestSession)).toBeNull();
    expect(verifyPassword("reset-password", accounts.findById(guest.id)!.passwordHash)).toBe(true);
    const body = await response.text();
    expect(body).not.toContain("passwordHash");
    expect(body).not.toContain("reset-password");
    expect(accounts.listAudit({ action: "PASSWORD_RESET" }).total).toBe(1);
  });

  it("does not let a non-admin reset another user's password", async () => {
    const guest = accounts.createUser({ username: "guest", password: "guest-password", role: "VIEWER" })!;
    const before = accounts.findById(guest.id)!.passwordHash;
    state.admin = null;

    const response = await patchUser(
      new Request(`http://localhost:3000/api/users/${guest.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "reset-password" }),
      }),
      params(guest.id),
    );
    expect(response.status).toBe(403);
    expect(accounts.findById(guest.id)!.passwordHash).toBe(before);
  });

  it("revokes another user's sessions without touching other accounts", async () => {
    const guest = accounts.createUser({ username: "guest", password: "guest-password", role: "VIEWER" })!;
    const guestSession = accounts.createSession({
      userId: guest.id,
      ip: null,
      userAgent: null,
      expiresAt: Date.now() + 60_000,
    });
    const ownSession = accounts.createSession({
      userId: user.id,
      ip: null,
      userAgent: null,
      expiresAt: Date.now() + 60_000,
    });

    const response = await revokeUserSessions(
      new Request(`http://localhost:3000/api/users/${guest.id}/sessions`, { method: "DELETE" }),
      params(guest.id),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, revoked: 1 });
    expect(accounts.getSession(guestSession)).toBeNull();
    expect(accounts.getSession(ownSession)).not.toBeNull();
    expect(accounts.listAudit({ action: "USER_SESSIONS_REVOKED" }).total).toBe(1);
  });

  it("refuses a non-admin session revocation and reports an unknown user", async () => {
    const guest = accounts.createUser({ username: "guest", password: "guest-password", role: "VIEWER" })!;
    const guestSession = accounts.createSession({
      userId: guest.id,
      ip: null,
      userAgent: null,
      expiresAt: Date.now() + 60_000,
    });

    state.admin = null;
    const forbidden = await revokeUserSessions(
      new Request(`http://localhost:3000/api/users/${guest.id}/sessions`, { method: "DELETE" }),
      params(guest.id),
    );
    expect(forbidden.status).toBe(403);
    expect(accounts.getSession(guestSession)).not.toBeNull();

    state.admin = { ...state.user!, role: "ADMIN" };
    const missing = await revokeUserSessions(
      new Request("http://localhost:3000/api/users/no-such-user/sessions", { method: "DELETE" }),
      params("no-such-user"),
    );
    expect(missing.status).toBe(404);
  });

  it("validates the reset password instead of truncating or accepting a short one", async () => {
    const guest = accounts.createUser({ username: "guest", password: "guest-password", role: "VIEWER" })!;
    const before = accounts.findById(guest.id)!.passwordHash;
    const response = await patchUser(
      new Request(`http://localhost:3000/api/users/${guest.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: "short" }),
      }),
      params(guest.id),
    );
    expect(response.status).toBe(400);
    expect(accounts.findById(guest.id)!.passwordHash).toBe(before);
  });
});

describe("self-service session management", () => {
  it("lists the caller's sessions, prunes expired rows, and marks the current one", async () => {
    const current = accounts.createSession({
      userId: user.id,
      ip: "10.0.0.1",
      userAgent: "current",
      expiresAt: Date.now() + 60_000,
    });
    accounts.createSession({
      userId: user.id,
      ip: "10.0.0.9",
      userAgent: "expired",
      expiresAt: Date.now() - 1,
    });
    state.user = { ...state.user!, sessionId: current };

    const response = await listOwnSessions();
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      sessions: Array<{ id: string; current: boolean; userAgent: string | null }>;
    };
    expect(body.sessions).toHaveLength(1);
    expect(body.sessions[0]!.id).toBe(current);
    expect(body.sessions[0]!.current).toBe(true);
    expect(JSON.stringify(body)).not.toContain("expired");
  });

  it("signs out other sessions but keeps the requesting session", async () => {
    const current = accounts.createSession({
      userId: user.id,
      ip: null,
      userAgent: "current",
      expiresAt: Date.now() + 60_000,
    });
    const other = accounts.createSession({
      userId: user.id,
      ip: null,
      userAgent: "other",
      expiresAt: Date.now() + 60_000,
    });
    state.user = { ...state.user!, sessionId: current };

    const response = await revokeOwnSessions(sessionRequest("DELETE", { scope: "others" }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, revoked: 1 });
    expect(accounts.getSession(current)).not.toBeNull();
    expect(accounts.getSession(other)).toBeNull();
  });

  it("signs out everywhere, including the current session, and clears the cookie", async () => {
    const current = accounts.createSession({
      userId: user.id,
      ip: null,
      userAgent: "current",
      expiresAt: Date.now() + 60_000,
    });
    state.user = { ...state.user!, sessionId: current };

    const response = await revokeOwnSessions(sessionRequest("DELETE", { scope: "all" }));
    expect(response.status).toBe(200);
    expect(accounts.getSession(current)).toBeNull();
    expect(response.headers.get("set-cookie")).toContain("cctv_session=");
  });

  it("rejects an unknown scope", async () => {
    const response = await revokeOwnSessions(sessionRequest("DELETE", { scope: "some" }));
    expect(response.status).toBe(400);
  });
});
