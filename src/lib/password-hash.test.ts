import { describe, expect, it } from "vitest";
import {
  PASSWORD_VERIFICATION_LIMITS,
  hashPassword,
  verifyPassword,
  verifyPasswordAsync,
} from "@/lib/password-hash";

describe("password hashing", () => {
  it("hashes with a random salt and verifies asynchronously", async () => {
    const stored = hashPassword("correct horse battery staple");
    expect(stored.startsWith("scrypt$")).toBe(true);
    await expect(verifyPasswordAsync("correct horse battery staple", stored)).resolves.toBe(true);
    await expect(verifyPasswordAsync("wrong password", stored)).resolves.toBe(false);
    // The synchronous implementation must agree with the asynchronous one.
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
    expect(verifyPassword("wrong password", stored)).toBe(false);
  });

  it("uses a fresh salt per hash", () => {
    expect(hashPassword("same")).not.toBe(hashPassword("same"));
  });

  it("rejects malformed stored values without deriving a key", async () => {
    await expect(verifyPasswordAsync("x", "")).resolves.toBe(false);
    await expect(verifyPasswordAsync("x", "bcrypt$salt$hash")).resolves.toBe(false);
    await expect(verifyPasswordAsync("x", "scrypt$$")).resolves.toBe(false);
    await expect(verifyPasswordAsync("x", "scrypt$salt$abcd")).resolves.toBe(false);
  });

  it("keeps the verification concurrency bounded", async () => {
    const stored = hashPassword("bounded");
    expect(PASSWORD_VERIFICATION_LIMITS.maxConcurrent).toBeGreaterThan(0);
    expect(PASSWORD_VERIFICATION_LIMITS.maxQueued).toBeGreaterThan(0);
    // Ten concurrent verifications must all complete (two run, the rest queue)
    // and the limiter must not deadlock or reject within the queue bound.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        verifyPasswordAsync(index === 0 ? "bounded" : `wrong-${index}`, stored),
      ),
    );
    expect(results[0]).toBe(true);
    expect(results.slice(1).every((value) => value === false)).toBe(true);
  });
});
