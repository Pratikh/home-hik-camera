import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Login hardening regression tests.
 *
 * These exercise the real route handler with a throwaway SQLite database and a
 * mocked socket peer, but a mocked password check so the suite stays fast. The
 * password-hash/scrypt concurrency behaviour is covered separately by
 * `src/lib/password-hash.test.ts`, and the throttle state machine by
 * `src/server/auth/login-throttle.test.ts`.
 */

const state = vi.hoisted(() => ({
  dataDir: "",
  peerIp: null as string | null,
  trustedProxies: [] as string[],
  config: {} as Record<string, unknown>,
  expectedPassword: "CorrectHorseBattery9!",
}));

vi.mock("@/lib/peer-ip", () => ({
  getPeerIp: () => state.peerIp,
  getPeerEncrypted: () => false,
  installPeerIpCapture: () => undefined,
  peerIpStore: () => ({ getStore: () => null }),
}));

vi.mock("@/lib/config", () => ({
  getConfig: () => state.config,
}));

vi.mock("@/lib/password-hash", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/password-hash")>();
  return {
    ...actual,
    verifyPasswordAsync: vi.fn(async (password: string) => password === state.expectedPassword),
  };
});

const { POST } = await import("@/app/api/auth/login/route");
const { resetRateLimits } = await import("@/lib/rate-limit");
const { accountStore } = await import("@/server/auth/accounts");

function login(
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return POST(
    new Request("http://127.0.0.1:3000/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function setCookieList(response: Response): string[] {
  const withGet = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = withGet.getSetCookie?.() ?? [];
  const single = response.headers.get("set-cookie");
  return values.length > 0 ? values : single ? [single] : [];
}

function lastAudit(action: string): { user_agent: string | null; resource: string | null; ip_address: string | null } | undefined {
  return accountStore(state.dataDir)
    .db.prepare("SELECT user_agent, resource, ip_address FROM audit_logs WHERE action = ? ORDER BY rowid DESC LIMIT 1")
    .get(action) as { user_agent: string | null; resource: string | null; ip_address: string | null } | undefined;
}

beforeEach(() => {
  state.dataDir = mkdtempSync(path.join(os.tmpdir(), "cctv-login-"));
  state.peerIp = "192.168.1.50";
  state.trustedProxies = [];
  state.config = {
    appConfigured: true,
    appUsername: "admin",
    appPassword: state.expectedPassword,
    sessionSecret: "test-session-secret-0123456789abcdef",
    cookieSecure: false,
    trustedProxies: state.trustedProxies,
    dataDir: state.dataDir,
  };
  resetRateLimits();
});

describe("login brute-force resistance", () => {
  it("ignores a forged X-Forwarded-For from a direct client", async () => {
    for (let index = 0; index < 5; index += 1) {
      const response = await login(
        { username: "admin", password: "wrong" },
        { "x-forwarded-for": `203.0.113.${index + 1}` },
      );
      expect(response.status).toBe(401);
    }
    // A freshly forged header must not have created a new account budget.
    const blocked = await login(
      { username: "admin", password: state.expectedPassword },
      { "x-forwarded-for": "198.51.100.200" },
    );
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("counts the address budget against the real peer, not forged headers", async () => {
    state.peerIp = "192.168.1.50";
    for (let index = 0; index < 20; index += 1) {
      const response = await login(
        { username: `user-${index}`, password: "wrong" },
        { "x-forwarded-for": `203.0.113.${index}` },
      );
      expect(response.status).toBe(401);
    }
    const blocked = await login(
      { username: "admin", password: state.expectedPassword },
      { "x-forwarded-for": "198.51.100.250" },
    );
    expect(blocked.status).toBe(429);
  });

  it("keeps independent address budgets for different LAN clients", async () => {
    state.peerIp = "192.168.1.10";
    for (let index = 0; index < 20; index += 1) {
      expect((await login({ username: `a-${index}`, password: "wrong" })).status).toBe(401);
    }
    expect((await login({ username: "admin", password: state.expectedPassword })).status).toBe(429);

    state.peerIp = "192.168.1.11";
    expect((await login({ username: "admin", password: state.expectedPassword })).status).toBe(200);
  });

  it("uses the forwarded client address when the peer is a trusted proxy", async () => {
    state.peerIp = "127.0.0.1";
    state.trustedProxies = ["127.0.0.1"];
    (state.config as { trustedProxies: string[] }).trustedProxies = state.trustedProxies;
    const cloudflare = { "cf-connecting-ip": "203.0.113.5" };
    for (let index = 0; index < 20; index += 1) {
      expect((await login({ username: `proxy-${index}`, password: "wrong" }, cloudflare)).status).toBe(401);
    }
    expect((await login({ username: "admin", password: state.expectedPassword }, cloudflare)).status).toBe(429);
    // A different tunnel client has its own budget and can still sign in.
    expect(
      (await login({ username: "admin", password: state.expectedPassword }, { "cf-connecting-ip": "198.51.100.7" }))
        .status,
    ).toBe(200);
  });

  it("rejects oversized bodies without consuming the account budget", async () => {
    const response = await login({ username: "admin", password: "x".repeat(9_000) });
    expect(response.status).toBe(401);
    expect((await login({ username: "admin", password: state.expectedPassword })).status).toBe(200);
  });
});

describe("login audit input bounds", () => {
  it("truncates an oversized User-Agent and normalises the recorded address", async () => {
    const response = await login(
      { username: "admin", password: "wrong" },
      { "user-agent": "A".repeat(8_000), "x-forwarded-for": "203.0.113.77" },
    );
    expect(response.status).toBe(401);
    const row = lastAudit("LOGIN_FAILED");
    expect(row?.user_agent?.length).toBe(256);
    // The forged header is ignored for a direct peer.
    expect(row?.ip_address).toBe("192.168.1.50");
  });
});

describe("session cookie transport", () => {
  it("marks the cookie Secure for an HTTPS request via the trusted proxy", async () => {
    state.peerIp = "127.0.0.1";
    state.trustedProxies = ["127.0.0.1"];
    (state.config as { trustedProxies: string[] }).trustedProxies = state.trustedProxies;
    const response = await login(
      { username: "admin", password: state.expectedPassword },
      { "x-forwarded-proto": "https", "cf-connecting-ip": "203.0.113.9" },
    );
    expect(response.status).toBe(200);
    expect(setCookieList(response).join(";")).toContain("Secure");
  });

  it("does not mark the cookie Secure for a direct LAN client claiming HTTPS", async () => {
    state.peerIp = "192.168.1.50";
    const response = await login(
      { username: "admin", password: state.expectedPassword },
      { "x-forwarded-proto": "https" },
    );
    expect(response.status).toBe(200);
    expect(setCookieList(response).join(";")).not.toContain("Secure");
  });
});
