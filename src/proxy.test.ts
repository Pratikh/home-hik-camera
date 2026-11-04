import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config, contentSecurityPolicy, proxy } from "@/proxy";
import { signSession } from "@/lib/session";

const SECRET = "proxy-test-session-secret-0123456789";

function apiRequest(path: string, cookie?: string): NextRequest {
  return new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : undefined,
  });
}

function cspOf(response: Response): string {
  return response.headers.get("content-security-policy") ?? "";
}

function scriptSrc(policy: string): string {
  return policy.split(";").map((part) => part.trim()).find((part) => part.startsWith("script-src")) ?? "";
}

describe("proxy matcher", () => {
  it("lets the development HMR WebSocket bypass authentication middleware", () => {
    const matcher = config.matcher.join(" ");
    expect(matcher).toContain("_next/hmr");
    expect(matcher).toContain("_next/webpack-hmr");
  });

  it("keeps private pages and account routes behind the session check", () => {
    const matcher = config.matcher.join(" ");
    expect(matcher).not.toContain("|account|");
    expect(matcher).not.toContain("|settings|");
    expect(matcher).not.toContain("|faces|");
  });
});

describe("Content-Security-Policy", () => {
  it("uses a nonce and strict-dynamic in production, without script unsafe-inline", () => {
    const policy = contentSecurityPolicy("abc123", false);
    expect(scriptSrc(policy)).toContain("'nonce-abc123'");
    expect(scriptSrc(policy)).toContain("'strict-dynamic'");
    expect(scriptSrc(policy)).not.toContain("'unsafe-inline'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("form-action 'self'");
    expect(policy).toContain("frame-ancestors 'none'");
  });

  it("keeps the development eval escape hatch so HMR hydrates", () => {
    const policy = contentSecurityPolicy("abc123", true);
    expect(scriptSrc(policy)).toContain("'unsafe-eval'");
  });

  it("attaches a per-request policy to redirects and rejections", async () => {
    const env = process.env as Record<string, string | undefined>;
    const savedNodeEnv = env.NODE_ENV;
    env.NODE_ENV = "production";
    try {
      const page = await proxy(apiRequest("/events"));
      expect(page.status).toBe(307);
      expect(cspOf(page)).toContain("script-src");
      expect(cspOf(page)).toMatch(/nonce-[A-Za-z0-9_-]+/);

      const api = await proxy(apiRequest("/api/users"));
      expect(api.status).toBe(401);
      expect(cspOf(api)).toContain("script-src");
      expect(cspOf(api)).toMatch(/nonce-[A-Za-z0-9_-]+/);
    } finally {
      if (savedNodeEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = savedNodeEnv;
    }
  });
});

describe("proxy access decisions", () => {
  const saved = { secret: process.env.SESSION_SECRET };
  beforeEach(() => {
    process.env.SESSION_SECRET = SECRET;
  });
  afterEach(() => {
    if (saved.secret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = saved.secret;
  });

  it("lets the public login and health endpoints through", async () => {
    const login = await proxy(apiRequest("/login"));
    expect(login.status).toBe(200);
    expect(login.headers.get("x-middleware-next")).toBe("1");
    const health = await proxy(apiRequest("/api/health"));
    expect(health.status).toBe(200);
  });

  it("lets a valid session through and rejects a forged one", async () => {
    const token = await signSession("home", SECRET);
    const allowed = await proxy(apiRequest("/events", `cctv_session=${token}`));
    expect(allowed.status).toBe(200);

    const forged = await proxy(apiRequest("/events", "cctv_session=payload.signature"));
    expect(forged.status).toBe(307);
  });
});
