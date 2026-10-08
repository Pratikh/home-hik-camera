import { describe, expect, it } from "vitest";
import { signSession, verifySession } from "@/lib/session";

const secret = "session-secret-value";

describe("session cookie", () => {
  it("signs and verifies a session", async () => {
    const token = await signSession("home", secret, 1_000);
    await expect(verifySession(token, secret, 1_000)).resolves.toEqual({ username: "home" });
  });

  it("rejects a tampered token, the wrong secret, and an expired session", async () => {
    const token = await signSession("home", secret, 1_000);
    const [payload, signature] = token.split(".");
    const flipped = signature?.endsWith("a") ? `${signature.slice(0, -1)}b` : `${signature?.slice(0, -1)}a`;
    expect(await verifySession(`${payload}.${flipped}`, secret, 1_000)).toBeNull();
    expect(await verifySession(token, "another-session-secret", 1_000)).toBeNull();
    expect(await verifySession(token, secret, 1_000 + 8 * 24 * 60 * 60 * 1000)).toBeNull();
    expect(await verifySession(token, "short", 1_000)).toBeNull();
  });

  it("refuses to sign with a short secret", async () => {
    await expect(signSession("home", "short")).rejects.toThrow(/SESSION_SECRET/);
  });
});
