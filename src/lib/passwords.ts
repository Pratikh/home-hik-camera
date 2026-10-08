import { createHash, timingSafeEqual } from "node:crypto";

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
