import { isIP } from "node:net";

/**
 * Client-address resolution for rate limiting, audit logs and cookie policy.
 *
 * Rules:
 * - The TCP peer address is authoritative and always wins by default.
 * - Proxy headers (`CF-Connecting-IP`, `X-Forwarded-For`, `X-Real-IP`) are
 *   consulted **only** when the immediate peer is in the operator-configured
 *   `TRUSTED_PROXY_CIDRS` list. A direct LAN client is therefore unable to
 *   influence the resolved address by sending those headers.
 * - Nothing here trusts a forwarded header implicitly, and `Forwarded` (RFC
 *   7239) is deliberately not parsed.
 */

export type HeaderReader = { get(name: string): string | null };

/** Normalise an address for comparisons: brackets, zones, IPv4-mapped IPv6. */
export function normalizeIp(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  let raw = value.trim();
  if (!raw) return null;
  if (raw.startsWith("[") && raw.includes("]")) {
    raw = raw.slice(1, raw.indexOf("]"));
  }
  const zone = raw.indexOf("%");
  if (zone !== -1) raw = raw.slice(0, zone);
  if (raw.toLowerCase().startsWith("::ffff:")) {
    const mapped = raw.slice("::ffff:".length);
    if (isIP(mapped) === 4) raw = mapped;
  }
  return isIP(raw) ? raw : null;
}

function ipv4ToBigInt(ip: string): bigint {
  return ip
    .split(".")
    .map((part) => BigInt(Number(part)))
    .reduce((total, part) => (total << 8n) | part, 0n);
}

function ipv6ToBigInt(ip: string): bigint | null {
  let value = ip;
  // An embedded IPv4 tail (::ffff:192.0.2.1) is written as two hex groups so
  // the generic path below can expand it.
  const lastColon = value.lastIndexOf(":");
  if (lastColon !== -1 && value.slice(lastColon + 1).includes(".")) {
    const v4 = value.slice(lastColon + 1).split(".").map((part) => Number(part));
    if (v4.length !== 4 || v4.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return null;
    const hi = ((v4[0] << 8) | v4[1]).toString(16);
    const lo = ((v4[2] << 8) | v4[3]).toString(16);
    value = `${value.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && left.length !== 8) return null;
  const missing = 8 - left.length - right.length;
  if (missing < 0) return null;
  const groups = [...left, ...Array<string>(missing).fill("0"), ...right];
  if (groups.length !== 8) return null;
  let result = 0n;
  for (const group of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
    result = (result << 16n) | BigInt(parseInt(group, 16));
  }
  return result;
}

/** Convert an address to a BigInt; returns null for anything not an IP literal. */
export function ipToBigInt(ip: string): bigint | null {
  const normalized = normalizeIp(ip);
  if (!normalized) return null;
  const version = isIP(normalized);
  if (version === 4) return ipv4ToBigInt(normalized);
  if (version === 6) return ipv6ToBigInt(normalized);
  return null;
}

type ParsedRange = { family: 4 | 6; base: bigint; bits: number };

function parseRange(entry: string): ParsedRange | null {
  const trimmed = entry.trim();
  if (!trimmed) return null;
  const slash = trimmed.lastIndexOf("/");
  const addressPart = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const address = normalizeIp(addressPart);
  if (!address) return null;
  const family = isIP(address) as 4 | 6;
  const maxBits = family === 4 ? 32 : 128;
  let bits = maxBits;
  if (slash !== -1) {
    const prefix = trimmed.slice(slash + 1).trim();
    if (!/^\d{1,3}$/.test(prefix)) return null;
    bits = Number(prefix);
    if (!Number.isInteger(bits) || bits < 0 || bits > maxBits) return null;
  }
  const base = family === 4 ? ipv4ToBigInt(address) : ipv6ToBigInt(address);
  if (base === null) return null;
  const shift = BigInt(maxBits - bits);
  return { family, base: (base >> shift) << shift, bits };
}

/** Parse `TRUSTED_PROXY_CIDRS` ("127.0.0.1,::1,10.0.0.0/8") into entries. */
export function parseTrustedProxies(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** True when `ip` falls inside any configured trusted-proxy range. */
export function isTrustedProxy(
  ip: string | null | undefined,
  trustedProxies: readonly string[],
): boolean {
  const normalized = normalizeIp(ip);
  if (!normalized) return false;
  const family = isIP(normalized) as 4 | 6;
  const value = family === 4 ? ipv4ToBigInt(normalized) : ipv6ToBigInt(normalized);
  if (value === null) return false;
  for (const entry of trustedProxies) {
    const range = parseRange(entry);
    if (!range || range.family !== family) continue;
    const shift = BigInt((family === 4 ? 32 : 128) - range.bits);
    if ((value >> shift) === (range.base >> shift)) return true;
  }
  return false;
}

/**
 * Resolve the client address for a request.
 *
 * `peerIp` must come from the socket (see `@/lib/peer-ip`), never from a
 * header. When the peer is not a configured trusted proxy, all forwarding
 * headers are ignored.
 */
export function resolveClientIp(input: {
  peerIp: string | null;
  trustedProxies: readonly string[];
  headers: HeaderReader;
}): string | null {
  const peer = normalizeIp(input.peerIp);
  if (!peer) return null;
  if (!isTrustedProxy(peer, input.trustedProxies)) return peer;

  // Cloudflare sets CF-Connecting-IP to the real client for tunnel traffic; it
  // is a single address and is only read when the peer is our trusted tunnel.
  const cf = (input.headers.get("cf-connecting-ip") ?? "").split(",")[0];
  const cloudflare = normalizeIp(cf);
  if (cloudflare) return cloudflare;

  // Walk X-Forwarded-For from the nearest hop to the farthest, skipping our own
  // trusted proxies; the first untrusted address is the client.
  const forwarded = input.headers.get("x-forwarded-for");
  if (forwarded) {
    const hops = forwarded
      .split(",")
      .map((hop) => normalizeIp(hop))
      .filter((hop): hop is string => hop !== null);
    for (let index = hops.length - 1; index >= 0; index -= 1) {
      if (isTrustedProxy(hops[index], input.trustedProxies)) continue;
      return hops[index];
    }
    if (hops.length > 0) return hops[hops.length - 1];
  }

  const real = normalizeIp(input.headers.get("x-real-ip"));
  if (real) return real;

  // The proxy did not tell us who the client was; use the proxy address itself
  // rather than inventing one.
  return peer;
}
