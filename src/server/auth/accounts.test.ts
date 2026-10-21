import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/password-hash";
import { consumeRateLimit, resetRateLimits } from "@/lib/rate-limit";
import { memoryEventStore } from "@/server/events/event-store";
import { AccountStore } from "@/server/auth/accounts";

describe("accounts", () => {
  it("hashes passwords and rejects a disabled user", () => {
    const stored = hashPassword("correct-horse");
    expect(stored).not.toContain("correct-horse");
    expect(verifyPassword("correct-horse", stored)).toBe(true);
    expect(verifyPassword("wrong-horse", stored)).toBe(false);
    const accounts = new AccountStore(memoryEventStore().db);
    accounts.ensureBootstrapAdmin("home", "correct-horse");
    const admin = accounts.findByUsername("home");
    expect(admin?.role).toBe("ADMIN");
    expect(accounts.updateUser(admin!.id, { enabled: false })).toBe("last_admin");
    const viewer = accounts.createUser({ username: "guest", password: "another-secret", role: "VIEWER" });
    expect(viewer?.enabled).toBe(true);
    expect(accounts.updateUser(viewer!.id, { enabled: false })).toBe("ok");
    expect(accounts.findByUsername("guest")?.enabled).toBe(false);
    expect(accounts.deleteUser(admin!.id)).toBe("last_admin");
  });

  it("limits repeated login attempts", () => {
    resetRateLimits();
    for (let attempt = 0; attempt < 8; attempt += 1) expect(consumeRateLimit("login:test", 8, 1000, 1).allowed).toBe(true);
    expect(consumeRateLimit("login:test", 8, 1000, 1).allowed).toBe(false);
  });
});

describe("password and session lifecycle", () => {
  function setup() {
    const accounts = new AccountStore(memoryEventStore().db);
    const user = accounts.createUser({ username: "home", password: "old-password", role: "ADMIN" })!;
    return { accounts, user };
  }

  it("changing a password invalidates every old session and keeps the new one usable", () => {
    const { accounts, user } = setup();
    const first = accounts.createSession({ userId: user.id, ip: "10.0.0.1", userAgent: "one", expiresAt: Date.now() + 60_000 });
    const second = accounts.createSession({ userId: user.id, ip: "10.0.0.2", userAgent: "two", expiresAt: Date.now() + 60_000 });

    expect(accounts.updateUser(user.id, { password: "new-password" })).toBe("ok");
    expect(accounts.getSession(first)).toBeNull();
    expect(accounts.getSession(second)).toBeNull();
    expect(verifyPassword("new-password", accounts.findById(user.id)!.passwordHash)).toBe(true);
    expect(verifyPassword("old-password", accounts.findById(user.id)!.passwordHash)).toBe(false);

    const fresh = accounts.createSession({ userId: user.id, ip: "10.0.0.1", userAgent: "one", expiresAt: Date.now() + 60_000 });
    expect(accounts.getSession(fresh)?.username).toBe("home");
  });

  it("an admin reset also invalidates sessions and stores a scrypt hash, never plaintext", () => {
    const { accounts } = setup();
    const guest = accounts.createUser({ username: "guest", password: "guest-password", role: "VIEWER" })!;
    const session = accounts.createSession({ userId: guest.id, ip: null, userAgent: null, expiresAt: Date.now() + 60_000 });

    expect(accounts.updateUser(guest.id, { password: "reset-password" })).toBe("ok");
    expect(accounts.getSession(session)).toBeNull();
    const stored = accounts.findById(guest.id)!.passwordHash;
    expect(stored.startsWith("scrypt$")).toBe(true);
    expect(stored).not.toContain("reset-password");
    expect(JSON.stringify(accounts.listUsers())).not.toContain("passwordHash");
    expect(JSON.stringify(accounts.listUsers())).not.toContain(stored);
  });

  it("prunes only expired sessions and preserves active ones", () => {
    const { accounts, user } = setup();
    const now = Date.now();
    const expired = accounts.createSession({ userId: user.id, ip: null, userAgent: null, expiresAt: now - 1 });
    const active = accounts.createSession({ userId: user.id, ip: null, userAgent: null, expiresAt: now + 60_000 });

    expect(accounts.pruneExpiredSessions(now)).toBe(1);
    expect(accounts.getSession(expired)).toBeNull();
    expect(accounts.getSession(active)).not.toBeNull();
    // Idempotent: a second pass removes nothing and keeps the active session.
    expect(accounts.pruneExpiredSessions(now)).toBe(0);
    expect(accounts.getSession(active)).not.toBeNull();
  });

  it("signs out other sessions without destroying the current one", () => {
    const { accounts, user } = setup();
    const current = accounts.createSession({ userId: user.id, ip: null, userAgent: "current", expiresAt: Date.now() + 60_000 });
    const other = accounts.createSession({ userId: user.id, ip: null, userAgent: "other", expiresAt: Date.now() + 60_000 });

    expect(accounts.deleteSessionsForUser(user.id, current)).toBe(1);
    expect(accounts.getSession(current)).not.toBeNull();
    expect(accounts.getSession(other)).toBeNull();
  });

  it("revoking all sessions for a user leaves other users alone", () => {
    const { accounts, user } = setup();
    const guest = accounts.createUser({ username: "guest", password: "guest-password", role: "VIEWER" })!;
    const adminSession = accounts.createSession({ userId: user.id, ip: null, userAgent: null, expiresAt: Date.now() + 60_000 });
    const guestSession = accounts.createSession({ userId: guest.id, ip: null, userAgent: null, expiresAt: Date.now() + 60_000 });

    expect(accounts.deleteSessionsForUser(user.id)).toBe(1);
    expect(accounts.getSession(adminSession)).toBeNull();
    expect(accounts.getSession(guestSession)).not.toBeNull();
  });
});
