/**
 * Secret redaction.
 *
 * Test failures print URLs, response bodies and console output. Any string that
 * might carry a credential passes through `redact()` first, so a failing test can
 * never leak a password into the HTML report, the terminal or CI logs.
 */

const secrets = new Set<string>();

export function registerSecret(value: string | undefined | null): void {
  // Very short values would redact unrelated text; real passwords are longer.
  if (value && value.length >= 4) secrets.add(value);
}

export function registerSecrets(values: Array<string | undefined | null>): void {
  for (const value of values) registerSecret(value);
}

export function redact(value: string): string {
  let out = value;
  for (const secret of secrets) out = out.split(secret).join("***REDACTED***");
  return out;
}

/** True when the text contains a registered credential. */
export function containsSecret(value: string): boolean {
  for (const secret of secrets) if (value.includes(secret)) return true;
  return false;
}

/**
 * Query-parameter names that must never carry a credential. A login must use
 * POST with a request body, never a query string.
 */
const FORBIDDEN_PARAMS = ["password", "passwd", "pwd", "credential", "secret", "token"];

export type UrlAudit = { ok: boolean; reason: string | null };

/** Inspect a URL without ever echoing the raw value. */
export function auditUrl(rawUrl: string): UrlAudit {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: "URL could not be parsed" };
  }
  for (const key of parsed.searchParams.keys()) {
    const lowered = key.toLowerCase();
    if (FORBIDDEN_PARAMS.some((bad) => lowered.includes(bad))) {
      return { ok: false, reason: `query parameter "${redact(key)}" is not allowed` };
    }
    if (lowered === "username" || lowered === "user") {
      return { ok: false, reason: `query parameter "${redact(key)}" is not allowed` };
    }
  }
  if (containsSecret(rawUrl)) {
    return { ok: false, reason: "a credential value appears in the URL" };
  }
  return { ok: true, reason: null };
}
