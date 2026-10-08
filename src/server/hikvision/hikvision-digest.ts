import { createHash, randomBytes } from "node:crypto";
import "server-only";

export type DigestChallenge = {
  realm: string;
  nonce: string;
  opaque?: string;
  qop?: string;
  algorithm?: string;
};

export function parseDigestChallenge(header: string): DigestChallenge | null {
  const digestIndex = header.toLowerCase().indexOf("digest");
  if (digestIndex < 0) return null;
  const source = header.slice(digestIndex + "digest".length);
  const params: Record<string, string> = {};
  const pattern = /([a-zA-Z][a-zA-Z0-9_-]*)\s*=\s*(?:"([^"]*)"|([^,\s]+))/g;
  for (const match of source.matchAll(pattern)) {
    params[(match[1] ?? "").toLowerCase()] = match[2] ?? match[3] ?? "";
  }
  if (!params.realm || !params.nonce) return null;
  const qop = params.qop
    ?.split(",")
    .map((part) => part.trim())
    .find((part) => part === "auth");
  return {
    realm: params.realm,
    nonce: params.nonce,
    opaque: params.opaque,
    qop,
    algorithm: params.algorithm,
  };
}

function md5(value: string): string {
  return createHash("md5").update(value).digest("hex");
}

function escapeQuotes(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

export function buildDigestAuthorization(input: {
  method: string;
  uri: string;
  username: string;
  password: string;
  challenge: DigestChallenge;
  cnonce?: string;
  nc?: string;
}): string {
  const algorithm = (input.challenge.algorithm || "MD5").toUpperCase();
  const cnonce = input.cnonce ?? randomBytes(8).toString("hex");
  const nc = input.nc ?? "00000001";
  let ha1 = md5(`${input.username}:${input.challenge.realm}:${input.password}`);
  if (algorithm === "MD5-SESS") {
    ha1 = md5(`${ha1}:${input.challenge.nonce}:${cnonce}`);
  }
  const ha2 = md5(`${input.method.toUpperCase()}:${input.uri}`);
  const qop = input.challenge.qop;
  const response = qop
    ? md5(`${ha1}:${input.challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${input.challenge.nonce}:${ha2}`);
  const parts = [
    `username="${escapeQuotes(input.username)}"`,
    `realm="${escapeQuotes(input.challenge.realm)}"`,
    `nonce="${escapeQuotes(input.challenge.nonce)}"`,
    `uri="${escapeQuotes(input.uri)}"`,
    `algorithm=${algorithm === "MD5-SESS" ? "MD5-sess" : "MD5"}`,
    `response="${response}"`,
  ];
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (input.challenge.opaque) parts.push(`opaque="${escapeQuotes(input.challenge.opaque)}"`);
  return `Digest ${parts.join(", ")}`;
}
