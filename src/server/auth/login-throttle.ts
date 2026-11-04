import type { DatabaseSync } from "node:sqlite";

/**
 * Persistent login throttling.
 *
 * Two independent, auto-expiring counters are kept in SQLite so a restart does
 * not reset an attack in progress:
 *
 * - **account** — keyed on the submitted username (whether or not it exists, so
 *   the response cannot be used to enumerate accounts). After a small number of
 *   failures inside a window it locks for a bounded period. The lock duration
 *   grows for repeat offenders but is capped, and it always expires on its own:
 *   an attacker can annoy one account for a while, never lock it permanently.
 * - **address** — keyed on the resolved client address (see `@/lib/client-ip`),
 *   with a higher threshold so a busy household behind one NAT address is not
 *   punished by a single mistyping user.
 *
 * Both counters are cleared by a successful login. Rows are pruned after
 * `RETENTION_MS`, and the caller may prune opportunistically on every login.
 */

export type ThrottlePolicy = {
  windowMs: number;
  maxFailures: number;
  baseLockMs: number;
  maxLockMs: number;
};

export const ACCOUNT_POLICY: ThrottlePolicy = {
  windowMs: 15 * 60 * 1000,
  maxFailures: 5,
  baseLockMs: 15 * 60 * 1000,
  maxLockMs: 60 * 60 * 1000,
};

export const ADDRESS_POLICY: ThrottlePolicy = {
  windowMs: 15 * 60 * 1000,
  maxFailures: 20,
  baseLockMs: 15 * 60 * 1000,
  maxLockMs: 60 * 60 * 1000,
};

/** How long a throttle row is kept after its last failure. */
export const THROTTLE_RETENTION_MS = 24 * 60 * 60 * 1000;

export type ThrottleBlockReason = "account_locked" | "address_locked";

export type ThrottleDecision =
  | { allowed: true }
  | { allowed: false; reason: ThrottleBlockReason; retryAfterMs: number };

type ThrottleRow = {
  key_type: string;
  key: string;
  failures: number;
  window_started_at: number;
  locked_until: number;
  lock_level: number;
  last_failure_at: number;
};

type KeyType = "account" | "address";

/** Account keys are case-insensitive so "Admin" and "admin" share one budget. */
export function accountThrottleKey(username: string): string {
  return username.trim().toLowerCase().slice(0, 64);
}

function readRow(db: DatabaseSync, keyType: KeyType, key: string): ThrottleRow | null {
  const row = db
    .prepare(
      "SELECT key_type, key, failures, window_started_at, locked_until, lock_level, last_failure_at FROM login_throttle WHERE key_type = ? AND key = ?",
    )
    .get(keyType, key) as ThrottleRow | undefined;
  return row ?? null;
}

function writeRow(
  db: DatabaseSync,
  keyType: KeyType,
  key: string,
  patch: {
    failures: number;
    windowStartedAt: number;
    lockedUntil: number;
    lockLevel: number;
    lastFailureAt: number;
  },
): void {
  db.prepare(
    `INSERT INTO login_throttle
       (key_type, key, failures, window_started_at, locked_until, lock_level, last_failure_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(key_type, key) DO UPDATE SET
       failures = excluded.failures,
       window_started_at = excluded.window_started_at,
       locked_until = excluded.locked_until,
       lock_level = excluded.lock_level,
       last_failure_at = excluded.last_failure_at`,
  ).run(
    keyType,
    key,
    patch.failures,
    patch.windowStartedAt,
    patch.lockedUntil,
    patch.lockLevel,
    patch.lastFailureAt,
  );
}

/** Is this account/address currently locked? Checks expire locks lazily. */
export function checkLoginThrottle(
  db: DatabaseSync,
  input: { username: string; clientIp: string | null; now?: number },
): ThrottleDecision {
  const now = input.now ?? Date.now();
  const account = readRow(db, "account", accountThrottleKey(input.username));
  if (account && account.locked_until > now) {
    return { allowed: false, reason: "account_locked", retryAfterMs: account.locked_until - now };
  }
  if (input.clientIp) {
    const address = readRow(db, "address", input.clientIp);
    if (address && address.locked_until > now) {
      return { allowed: false, reason: "address_locked", retryAfterMs: address.locked_until - now };
    }
  }
  return { allowed: true };
}

function recordFailure(
  db: DatabaseSync,
  keyType: KeyType,
  key: string,
  policy: ThrottlePolicy,
  now: number,
): void {
  const existing = readRow(db, keyType, key);
  if (!existing) {
    writeRow(db, keyType, key, {
      failures: 1,
      windowStartedAt: now,
      lockedUntil: 0,
      lockLevel: 0,
      lastFailureAt: now,
    });
    return;
  }

  // A lock that has expired starts a fresh budget; the repeat-offender level is
  // kept so the next lock is longer, but it can never become permanent.
  const lockExpired = existing.locked_until > 0 && existing.locked_until <= now;
  const windowExpired = now - existing.window_started_at > policy.windowMs;
  const failures = lockExpired || windowExpired ? 0 : existing.failures;
  const windowStartedAt = lockExpired || windowExpired ? now : existing.window_started_at;

  const nextFailures = failures + 1;
  let lockedUntil = 0;
  let lockLevel = existing.lock_level;
  if (nextFailures >= policy.maxFailures) {
    const multiplier = 2 ** Math.min(lockLevel, 4);
    lockedUntil = now + Math.min(policy.baseLockMs * multiplier, policy.maxLockMs);
    lockLevel += 1;
  }

  writeRow(db, keyType, key, {
    failures: nextFailures,
    windowStartedAt,
    lockedUntil,
    lockLevel,
    lastFailureAt: now,
  });
}

/** Record one failed credential check against both counters. */
export function recordLoginFailure(
  db: DatabaseSync,
  input: { username: string; clientIp: string | null; now?: number },
): void {
  const now = input.now ?? Date.now();
  recordFailure(db, "account", accountThrottleKey(input.username), ACCOUNT_POLICY, now);
  if (input.clientIp) {
    recordFailure(db, "address", input.clientIp, ADDRESS_POLICY, now);
  }
}

/** Clear both counters after a successful login. */
export function clearLoginFailures(
  db: DatabaseSync,
  input: { username: string; clientIp: string | null },
): void {
  db.prepare("DELETE FROM login_throttle WHERE key_type = 'account' AND key = ?").run(
    accountThrottleKey(input.username),
  );
  if (input.clientIp) {
    db.prepare("DELETE FROM login_throttle WHERE key_type = 'address' AND key = ?").run(input.clientIp);
  }
}

/**
 * Remove stale rows. Called opportunistically from the login route and by the
 * hourly maintenance timer so random-username attempts cannot grow the table
 * without bound.
 */
export function pruneLoginThrottle(db: DatabaseSync, now = Date.now()): number {
  const result = db
    .prepare("DELETE FROM login_throttle WHERE last_failure_at < ?")
    .run(now - THROTTLE_RETENTION_MS);
  return Number(result.changes);
}
