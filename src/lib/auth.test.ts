import { describe, expect, it } from "vitest";
import { credentialsMatch, evaluateLogin } from "@/lib/passwords";
import { requestUsesHttps } from "@/lib/auth";

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
  it("marks the cookie Secure for a request that arrived over HTTPS", () => {
    // Through a tunnel or proxy the app itself speaks HTTP, so the header decides.
    expect(requestUsesHttps(new Request("http://127.0.0.1:3000/api/auth/login", {
      headers: { "x-forwarded-proto": "https" },
    }))).toBe(true);
    expect(requestUsesHttps(new Request("https://hub.example/api/auth/login"))).toBe(true);
    // A comma-separated chain (proxy, proxy) uses the first hop.
    expect(requestUsesHttps(new Request("http://127.0.0.1:3000/api/auth/login", {
      headers: { "x-forwarded-proto": "https, http" },
    }))).toBe(true);
  });

  it("leaves plain HTTP LAN access working without the flag", () => {
    expect(requestUsesHttps(new Request("http://192.168.1.56:3000/api/auth/login"))).toBe(false);
    expect(requestUsesHttps(new Request("http://127.0.0.1:3000/api/auth/login", {
      headers: { "x-forwarded-proto": "http" },
    }))).toBe(false);
  });
});
