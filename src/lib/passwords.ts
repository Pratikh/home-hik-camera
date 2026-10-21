import { createHash, timingSafeEqual } from "node:crypto";

/**
 * The password policy already used when an administrator creates a user.
 * It is shared by self-service change, admin reset, and user creation so the
 * three paths cannot drift apart.
 */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

export type PasswordPolicyResult = { ok: true } | { ok: false; message: string };

export function validateNewPassword(password: string): PasswordPolicyResult {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` };
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    return { ok: false, message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` };
  }
  if (!password.trim()) return { ok: false, message: "Password cannot be only spaces." };
  return { ok: true };
}

export function safeEqual(left: string, right: string): boolean {
  const a = createHash("sha256").update(left).digest();
  const b = createHash("sha256").update(right).digest();
  return timingSafeEqual(a, b);
}

export function credentialsMatch(
  username: string,
  password: string,
  expectedUser: string,
  expectedPass: string,
): boolean {
  const userOk = safeEqual(username, expectedUser);
  const passOk = safeEqual(password, expectedPass);
  return userOk && passOk;
}

export function evaluateLogin(
  appConfigured: boolean,
  username: string,
  password: string,
  expectedUser: string,
  expectedPass: string,
): "ok" | "invalid_config" | "rejected" {
  if (!appConfigured) return "invalid_config";
  if (username.length > 200 || password.length > 200) return "rejected";
  return credentialsMatch(username, password, expectedUser, expectedPass) ? "ok" : "rejected";
}
