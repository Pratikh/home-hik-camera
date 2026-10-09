import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * QA environment resolution.
 *
 * All browser QA targets one desktop viewport. Mobile and every other desktop
 * resolution are deliberately out of scope for this suite.
 */
export const VIEWPORT = { width: 1920, height: 1080 } as const;

export const DEFAULT_BASE_URL = "http://localhost:3000";

export const AUTH_DIR = resolve(__dirname, "..", ".auth");
export const ADMIN_STATE = resolve(AUTH_DIR, "admin.json");
export const VIEWER_STATE = resolve(AUTH_DIR, "viewer.json");

export type Credentials = { username: string; password: string };

const QA_KEYS = [
  "QA_BASE_URL",
  "QA_ADMIN_USERNAME",
  "QA_ADMIN_PASSWORD",
  "QA_VIEWER_USERNAME",
  "QA_VIEWER_PASSWORD",
] as const;

/**
 * Parse a simple KEY=VALUE file. Values may be quoted. Comments and blank lines
 * are ignored. Nothing read here is ever printed.
 */
function parseEnvFile(file: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

let loaded = false;

/**
 * Populate `process.env` with the QA_* values.
 *
 * Resolution order per key: a real process environment variable, then
 * `.env.qa`, `.env.test`, `.env`. The ADMIN login may fall back to the
 * application's own `APP_USERNAME` / `APP_PASSWORD` so a local run needs no
 * duplicated secret file; the VIEWER login never falls back, because a viewer
 * password must be provisioned deliberately.
 *
 * Only the keys named above are copied. DVR credentials in `.env` are never
 * loaded into the test process.
 */
export function loadQaEnv(): void {
  if (loaded) return;
  loaded = true;

  const values: Record<string, string> = {};
  for (const name of [".env.qa", ".env.test", ".env"]) {
    const file = resolve(process.cwd(), name);
    if (!existsSync(file)) continue;
    let parsed: Record<string, string>;
    try {
      parsed = parseEnvFile(file);
    } catch {
      continue;
    }
    for (const key of QA_KEYS) {
      if (!values[key] && parsed[key]) values[key] = parsed[key];
    }
    if (!values.QA_ADMIN_USERNAME && parsed.APP_USERNAME) values.QA_ADMIN_USERNAME = parsed.APP_USERNAME;
    if (!values.QA_ADMIN_PASSWORD && parsed.APP_PASSWORD) values.QA_ADMIN_PASSWORD = parsed.APP_PASSWORD;
  }

  for (const [key, value] of Object.entries(values)) {
    if (!process.env[key]) process.env[key] = value;
  }
}

export function baseURL(): string {
  loadQaEnv();
  return (process.env.QA_BASE_URL ?? "").trim() || DEFAULT_BASE_URL;
}

function credentials(usernameKey: string, passwordKey: string): Credentials | null {
  loadQaEnv();
  const username = (process.env[usernameKey] ?? "").trim();
  const password = process.env[passwordKey] ?? "";
  if (!username || !password) return null;
  return { username, password };
}

/** ADMIN credentials, or null when they are not configured. */
export function adminCredentials(): Credentials | null {
  return credentials("QA_ADMIN_USERNAME", "QA_ADMIN_PASSWORD");
}

/** VIEWER credentials, or null when they are not configured. */
export function viewerCredentials(): Credentials | null {
  return credentials("QA_VIEWER_USERNAME", "QA_VIEWER_PASSWORD");
}

export function hasViewerCredentials(): boolean {
  return viewerCredentials() !== null;
}

export function requireAdminCredentials(): Credentials {
  const found = adminCredentials();
  if (!found) {
    throw new Error(
      "QA_ADMIN_USERNAME / QA_ADMIN_PASSWORD are not set. Add them to .env.qa (see .env.example) before running the Playwright suite.",
    );
  }
  return found;
}

export function requireViewerCredentials(): Credentials {
  const found = viewerCredentials();
  if (!found) {
    throw new Error(
      "QA_VIEWER_USERNAME / QA_VIEWER_PASSWORD are not set. Add them to .env.qa (see .env.example) to run the VIEWER role tests.",
    );
  }
  return found;
}
