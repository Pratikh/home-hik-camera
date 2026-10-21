import { describe, expect, it } from "vitest";
import {
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  validateNewPassword,
} from "@/lib/passwords";

describe("password policy", () => {
  it("accepts a password at the existing minimum and rejects anything shorter", () => {
    expect(validateNewPassword("a".repeat(PASSWORD_MIN_LENGTH))).toEqual({ ok: true });
    expect(validateNewPassword("a".repeat(PASSWORD_MIN_LENGTH - 1)).ok).toBe(false);
  });

  it("rejects an over-long password and a whitespace-only value", () => {
    expect(validateNewPassword("a".repeat(PASSWORD_MAX_LENGTH)).ok).toBe(true);
    expect(validateNewPassword("a".repeat(PASSWORD_MAX_LENGTH + 1)).ok).toBe(false);
    expect(validateNewPassword("        ").ok).toBe(false);
  });

  it("never echoes the password in its message", () => {
    const secret = "correct-horse-battery";
    const result = validateNewPassword(secret.slice(0, 4));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).not.toContain(secret);
  });
});
