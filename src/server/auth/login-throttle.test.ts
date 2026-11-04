import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { openEventStore } from "@/server/events/event-store";
import {
  ACCOUNT_POLICY,
  ADDRESS_POLICY,
  accountThrottleKey,
  checkLoginThrottle,
  clearLoginFailures,
  pruneLoginThrottle,
  recordLoginFailure,
  THROTTLE_RETENTION_MS,
} from "@/server/auth/login-throttle";

function freshDb() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "cctv-throttle-"));
  return openEventStore(dir).db;
}

describe("login throttle", () => {
  let db: ReturnType<typeof freshDb>;
  beforeEach(() => {
    db = freshDb();
  });

  it("locks an account after the configured number of failures", () => {
    const now = 1_000_000;
    for (let index = 0; index < ACCOUNT_POLICY.maxFailures; index += 1) {
      expect(checkLoginThrottle(db, { username: "admin", clientIp: null, now }).allowed).toBe(true);
      recordLoginFailure(db, { username: "admin", clientIp: null, now });
    }
    const decision = checkLoginThrottle(db, { username: "admin", clientIp: null, now: now + 1 });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("account_locked");
      expect(decision.retryAfterMs).toBeGreaterThan(0);
      expect(decision.retryAfterMs).toBeLessThanOrEqual(ACCOUNT_POLICY.maxLockMs);
    }
  });

  it("treats usernames case-insensitively", () => {
    expect(accountThrottleKey("  Admin ")).toBe("admin");
    const now = 2_000_000;
    for (let index = 0; index < ACCOUNT_POLICY.maxFailures; index += 1) {
      recordLoginFailure(db, { username: "Admin", clientIp: null, now });
    }
    expect(checkLoginThrottle(db, { username: "admin", clientIp: null, now }).allowed).toBe(false);
  });

  it("locks unknown usernames as well, so the lock cannot enumerate accounts", () => {
    const now = 3_000_000;
    for (let index = 0; index < ACCOUNT_POLICY.maxFailures; index += 1) {
      recordLoginFailure(db, { username: "ghost", clientIp: null, now });
    }
    expect(checkLoginThrottle(db, { username: "ghost", clientIp: null, now }).allowed).toBe(false);
  });

  it("expires a lock on its own and never becomes permanent", () => {
    const now = 4_000_000;
    for (let index = 0; index < ACCOUNT_POLICY.maxFailures; index += 1) {
      recordLoginFailure(db, { username: "admin", clientIp: null, now });
    }
    const locked = checkLoginThrottle(db, { username: "admin", clientIp: null, now });
    expect(locked.allowed).toBe(false);
    const lockedUntil = locked.allowed ? now : now + locked.retryAfterMs;
    expect(checkLoginThrottle(db, { username: "admin", clientIp: null, now: lockedUntil + 1 }).allowed).toBe(true);
  });

  it("caps the repeat-offender lock duration", () => {
    let now = 5_000_000;
    for (let cycle = 0; cycle < 8; cycle += 1) {
      for (let index = 0; index < ACCOUNT_POLICY.maxFailures; index += 1) {
        recordLoginFailure(db, { username: "admin", clientIp: null, now });
      }
      const decision = checkLoginThrottle(db, { username: "admin", clientIp: null, now });
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.retryAfterMs).toBeLessThanOrEqual(ACCOUNT_POLICY.maxLockMs);
      now += (decision.allowed ? 0 : decision.retryAfterMs) + 1;
    }
  });

  it("tracks addresses separately from accounts", () => {
    const now = 6_000_000;
    for (let index = 0; index < ADDRESS_POLICY.maxFailures; index += 1) {
      recordLoginFailure(db, { username: `user-${index}`, clientIp: "203.0.113.9", now });
    }
    const decision = checkLoginThrottle(db, { username: "someone", clientIp: "203.0.113.9", now });
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("address_locked");
    // A different address is unaffected.
    expect(checkLoginThrottle(db, { username: "someone", clientIp: "198.51.100.2", now }).allowed).toBe(true);
  });

  it("clears both counters after a successful login", () => {
    const now = 7_000_000;
    for (let index = 0; index < ACCOUNT_POLICY.maxFailures; index += 1) {
      recordLoginFailure(db, { username: "admin", clientIp: "203.0.113.9", now });
    }
    clearLoginFailures(db, { username: "admin", clientIp: "203.0.113.9" });
    expect(checkLoginThrottle(db, { username: "admin", clientIp: "203.0.113.9", now }).allowed).toBe(true);
  });

  it("prunes stale rows", () => {
    const now = 8_000_000;
    recordLoginFailure(db, { username: "old", clientIp: "203.0.113.9", now });
    expect(pruneLoginThrottle(db, now + THROTTLE_RETENTION_MS + 1)).toBeGreaterThan(0);
    expect(checkLoginThrottle(db, { username: "old", clientIp: "203.0.113.9", now: now + THROTTLE_RETENTION_MS + 2 }).allowed).toBe(true);
  });
});
