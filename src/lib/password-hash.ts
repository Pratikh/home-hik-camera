import { randomBytes, scrypt, scryptSync, timingSafeEqual } from "node:crypto";

const KEY_LENGTH = 64;
const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;

/**
 * scrypt is deliberately CPU/memory heavy, which is exactly why login must not
 * run it synchronously on the single Node event loop: a handful of concurrent
 * guesses for a known username would stall every API route, SSE stream and the
 * DVR event processor. `verifyPasswordAsync` offloads the derivation to libuv's
 * threadpool and bounds how many derivations may be in flight, so a login flood
 * degrades into backpressure (503) instead of a whole-application stall.
 */
const MAX_CONCURRENT_VERIFICATIONS = 2;
const MAX_QUEUED_VERIFICATIONS = 64;

export const PASSWORD_VERIFICATION_LIMITS = {
  maxConcurrent: MAX_CONCURRENT_VERIFICATIONS,
  maxQueued: MAX_QUEUED_VERIFICATIONS,
} as const;

let activeVerifications = 0;
const verificationQueue: Array<() => void> = [];

/** Raised when more password verifications are queued than the server allows. */
export class PasswordVerificationBusyError extends Error {
  constructor() {
    super("Password verification queue is full");
    this.name = "PasswordVerificationBusyError";
  }
}

function acquireVerificationSlot(): Promise<void> {
  if (activeVerifications < MAX_CONCURRENT_VERIFICATIONS) {
    activeVerifications += 1;
    return Promise.resolve();
  }
  if (verificationQueue.length >= MAX_QUEUED_VERIFICATIONS) {
    return Promise.reject(new PasswordVerificationBusyError());
  }
  return new Promise<void>((resolve) => {
    verificationQueue.push(resolve);
  });
}

function releaseVerificationSlot(): void {
  const next = verificationQueue.shift();
  if (next) {
    // Hand the slot over directly so the concurrency cap cannot be exceeded by
    // a new request racing the queued one.
    next();
    return;
  }
  activeVerifications = Math.max(0, activeVerifications - 1);
}

function derive(password: string, salt: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password,
      salt,
      KEY_LENGTH,
      { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P },
      (error, key) => {
        if (error) reject(error);
        else resolve(key);
      },
    );
  });
}

/** Hash a password with scrypt and a fresh 16-byte salt (format `scrypt$salt$hash`). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P }).toString("hex");
  return `scrypt$${salt}$${hash}`;
}

/**
 * Verify a password without blocking the event loop.
 *
 * Throws `PasswordVerificationBusyError` when the bounded queue is full; callers
 * should answer 503/429 rather than queueing without limit.
 */
export async function verifyPasswordAsync(password: string, stored: string): Promise<boolean> {
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== KEY_LENGTH) return false;

  await acquireVerificationSlot();
  try {
    const actual = await derive(password, salt);
    if (expected.length !== actual.length) return false;
    return timingSafeEqual(expected, actual);
  } finally {
    releaseVerificationSlot();
  }
}

/**
 * Synchronous verification, kept for hashing/verification APIs that are not on
 * an unauthenticated request path (and for test helpers). The login and
 * password-change routes use `verifyPasswordAsync`.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const [algorithm, salt, hash] = stored.split("$");
  if (algorithm !== "scrypt" || !salt || !hash) return false;
  const actual = scryptSync(password, salt, KEY_LENGTH, { N: SCRYPT_N, r: SCRYPT_R, p: SCRYPT_P });
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

/** Number of verifications currently in flight or waiting (test/diagnostics). */
export function passwordVerificationInFlight(): number {
  return activeVerifications + verificationQueue.length;
}
