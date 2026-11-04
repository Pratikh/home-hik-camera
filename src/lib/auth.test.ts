import { describe, expect, it } from "vitest";
import { credentialsMatch, evaluateLogin } from "@/lib/passwords";
import { requestUsesHttps, sessionCookieOptions } from "@/lib/auth";

describe("login", () => {
  it("rejects a wrong password and a wrong username", () => {
    expect(credentialsMatch("home", "nope", "home", "correct-horse")).toBe(false);
    expect(credentialsMatch("other", "correct-horse", "home", "correct-horse")).toBe(false);
    expect(credentialsMatch("home", "correct-horse", "home", "correct-horse")).toBe(true);
  });

  it("rejects login when application configuration is missing", () => {
    expect(evaluateLogin(false, "home", "correct-horse", "home", "correct-horse")).toBe("invalid_config");
    expect(evaluateLogin(true, "home", "wrong", "home", "correct-horse")).toBe("rejected");
    expect(evaluateLogin(true, "home", "correct-horse", "home", "correct-horse")).toBe("ok");
  });
});

describe("session cookie security", () => {
  it("trusts X-Forwarded-Proto only from a configured trusted proxy", () => {
    const request = new Request("http://127.0.0.1:3000/api/auth/login", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(requestUsesHttps(request, "127.0.0.1", ["127.0.0.1"], false)).toBe(true);
    // A direct LAN client claiming HTTPS must not influence the cookie policy,
    // even though Next builds request.url from that header.
    expect(requestUsesHttps(request, "192.168.1.50", ["127.0.0.1"], false)).toBe(false);
    expect(requestUsesHttps(request, "192.168.1.50", [], false)).toBe(false);
  });

  it("uses the socket TLS state, not the URL, for a direct connection", () => {
    const spoofedUrl = new Request("https://hub.example/api/auth/login", {
      headers: { "x-forwarded-proto": "https" },
    });
    expect(requestUsesHttps(spoofedUrl, "192.168.1.50", [], false)).toBe(false);
    expect(requestUsesHttps(spoofedUrl, "192.168.1.50", [], true)).toBe(true);
  });

  it("falls back to the URL protocol only outside a request scope", () => {
    expect(requestUsesHttps(new Request("https://hub.example/api/auth/login"), null, [], null)).toBe(true);
    expect(requestUsesHttps(new Request("http://192.168.1.56:3000/api/auth/login"), null, [], null)).toBe(false);
  });

  it("does not trust an empty or malformed proto chain from a trusted proxy", () => {
    const request = new Request("http://127.0.0.1:3000/api/auth/login", {
      headers: { "x-forwarded-proto": "https, http" },
    });
    expect(requestUsesHttps(request, "127.0.0.1", ["127.0.0.1"], false)).toBe(true);
    expect(requestUsesHttps(request, "127.0.0.1", ["127.0.0.1"], false)).toBe(true);
    const noHeader = new Request("http://127.0.0.1:3000/api/auth/login");
    expect(requestUsesHttps(noHeader, "127.0.0.1", ["127.0.0.1"], false)).toBe(false);
  });

  it("sets hardened cookie attributes", () => {
    const options = sessionCookieOptions(true);
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/", priority: "high" });
  });
});
