const encoder = new TextEncoder();

export const COOKIE_NAME = "cctv_session";
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  try {
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function fixedEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}

async function sign(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function signSession(
  username: string,
  secret: string,
  now = Date.now(),
  extras?: { sessionId?: string; role?: "ADMIN" | "VIEWER" },
): Promise<string> {
  if (secret.length < 16) {
    throw new Error("SESSION_SECRET must be at least 16 characters");
  }
  const body: { u: string; exp: number; sid?: string; role?: "ADMIN" | "VIEWER" } = {
    u: username,
    exp: now + SESSION_TTL_MS,
  };
  if (extras?.sessionId) body.sid = extras.sessionId;
  if (extras?.role) body.role = extras.role;
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(body)));
  const signature = await sign(secret, payload);
  return `${payload}.${signature}`;
}

export async function verifySession(
  token: string,
  secret: string,
  now = Date.now(),
): Promise<{ username: string; sessionId?: string; role?: "ADMIN" | "VIEWER" } | null> {
  if (secret.length < 16) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [payload, signature] = parts;
  if (!payload || !signature) return null;
  const expected = await sign(secret, payload);
  if (!fixedEqual(expected, signature)) return null;
  const bytes = base64UrlToBytes(payload);
  if (!bytes) return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as {
      u?: unknown;
      exp?: unknown;
      sid?: unknown;
      role?: unknown;
    };
    if (typeof parsed.u !== "string" || parsed.u.length === 0) return null;
    if (typeof parsed.exp !== "number" || !Number.isFinite(parsed.exp) || parsed.exp < now) return null;
    const session: { username: string; sessionId?: string; role?: "ADMIN" | "VIEWER" } = { username: parsed.u };
    if (typeof parsed.sid === "string") session.sessionId = parsed.sid;
    if (parsed.role === "ADMIN" || parsed.role === "VIEWER") session.role = parsed.role;
    return session;
  } catch {
    return null;
  }
}
