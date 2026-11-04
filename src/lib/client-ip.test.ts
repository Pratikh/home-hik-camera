import { describe, expect, it } from "vitest";
import {
  isTrustedProxy,
  normalizeIp,
  parseTrustedProxies,
  resolveClientIp,
} from "@/lib/client-ip";

function headers(values: Record<string, string>): { get(name: string): string | null } {
  const lower = new Map(Object.entries(values).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => lower.get(name.toLowerCase()) ?? null };
}

describe("normalizeIp", () => {
  it("accepts plain IPv4 and IPv6 addresses", () => {
    expect(normalizeIp("192.168.1.20")).toBe("192.168.1.20");
    expect(normalizeIp("::1")).toBe("::1");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
  });

  it("strips brackets, zones and the IPv4-mapped prefix", () => {
    expect(normalizeIp("[::1]")).toBe("::1");
    expect(normalizeIp("fe80::1%en0")).toBe("fe80::1");
    expect(normalizeIp("::ffff:192.0.2.10")).toBe("192.0.2.10");
  });

  it("rejects hostnames, blanks and garbage", () => {
    expect(normalizeIp("hub.example")).toBeNull();
    expect(normalizeIp("")).toBeNull();
    expect(normalizeIp("   ")).toBeNull();
    expect(normalizeIp("999.1.1.1")).toBeNull();
    expect(normalizeIp("not an ip")).toBeNull();
  });
});

describe("trusted proxy matching", () => {
  const proxies = parseTrustedProxies("127.0.0.1,::1,10.0.0.0/8,172.18.0.0/16");

  it("matches single addresses and CIDR ranges", () => {
    expect(isTrustedProxy("127.0.0.1", proxies)).toBe(true);
    expect(isTrustedProxy("::1", proxies)).toBe(true);
    expect(isTrustedProxy("10.4.5.6", proxies)).toBe(true);
    expect(isTrustedProxy("172.18.3.4", proxies)).toBe(true);
    expect(isTrustedProxy("192.168.1.10", proxies)).toBe(false);
    expect(isTrustedProxy("11.0.0.1", proxies)).toBe(false);
    expect(isTrustedProxy(null, proxies)).toBe(false);
  });

  it("does not mix address families", () => {
    expect(isTrustedProxy("::ffff:10.0.0.1", proxies)).toBe(true);
    expect(isTrustedProxy("::1", parseTrustedProxies("10.0.0.0/8"))).toBe(false);
  });

  it("ignores malformed entries instead of throwing", () => {
    const malformed = parseTrustedProxies("not-an-ip,10.0.0.0/99,,");
    expect(isTrustedProxy("10.0.0.1", malformed)).toBe(false);
  });
});

describe("resolveClientIp", () => {
  it("uses the TCP peer for a direct client and ignores forged headers", () => {
    expect(
      resolveClientIp({
        peerIp: "192.168.1.55",
        trustedProxies: ["127.0.0.1"],
        headers: headers({
          "x-forwarded-for": "203.0.113.9",
          "cf-connecting-ip": "198.51.100.7",
          "x-real-ip": "198.51.100.8",
        }),
      }),
    ).toBe("192.168.1.55");
  });

  it("uses CF-Connecting-IP when the peer is the trusted tunnel", () => {
    expect(
      resolveClientIp({
        peerIp: "127.0.0.1",
        trustedProxies: ["127.0.0.1"],
        headers: headers({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9" }),
      }),
    ).toBe("203.0.113.9");
  });

  it("walks X-Forwarded-For from the nearest hop, skipping trusted proxies", () => {
    expect(
      resolveClientIp({
        peerIp: "127.0.0.1",
        trustedProxies: ["127.0.0.1", "10.0.0.0/8"],
        // The left-most entry is what a client can prepend; the right-most
        // untrusted hop is the address the last trusted proxy actually saw.
        headers: headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.9, 10.1.2.3" }),
      }),
    ).toBe("203.0.113.9");
  });

  it("falls back to the proxy address when a trusted peer supplies no usable header", () => {
    expect(
      resolveClientIp({
        peerIp: "127.0.0.1",
        trustedProxies: ["127.0.0.1"],
        headers: headers({}),
      }),
    ).toBe("127.0.0.1");
  });

  it("returns null when there is no peer address at all", () => {
    expect(
      resolveClientIp({ peerIp: null, trustedProxies: ["127.0.0.1"], headers: headers({ "x-forwarded-for": "203.0.113.9" }) }),
    ).toBeNull();
  });

  it("normalises the peer and header values", () => {
    expect(
      resolveClientIp({
        peerIp: "::ffff:192.168.1.55",
        trustedProxies: [],
        headers: headers({}),
      }),
    ).toBe("192.168.1.55");
    expect(
      resolveClientIp({
        peerIp: "::1",
        trustedProxies: ["::1"],
        headers: headers({ "cf-connecting-ip": "2001:db8::7" }),
      }),
    ).toBe("2001:db8::7");
  });
});
