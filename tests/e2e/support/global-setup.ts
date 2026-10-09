import { mkdirSync } from "node:fs";
import { request } from "@playwright/test";
import {
  ADMIN_STATE,
  AUTH_DIR,
  VIEWER_STATE,
  adminCredentials,
  baseURL,
  loadQaEnv,
  viewerCredentials,
  type Credentials,
} from "./qa-env";
import { registerSecrets } from "./redact";

/**
 * Sign in once per role and persist the session cookie as a Playwright storage
 * state, so specs that need an authenticated page do not each spend a login.
 *
 * The files live under `tests/e2e/.auth/`, which is gitignored: they contain a
 * session cookie and are treated as a secret.
 */
async function saveState(credentials: Credentials, path: string, clientIp: string): Promise<void> {
  const api = await request.newContext({
    baseURL: baseURL(),
    extraHTTPHeaders: { "x-forwarded-for": clientIp },
  });
  try {
    const login = await api.post("/api/auth/login", {
      data: { username: credentials.username, password: credentials.password, next: "/" },
    });
    if (login.status() !== 200) {
      throw new Error(`QA setup: login failed with HTTP ${login.status()}`);
    }
    const session = await api.get("/api/auth/session");
    if (session.status() !== 200) {
      throw new Error(`QA setup: session check failed with HTTP ${session.status()}`);
    }
    await api.storageState({ path });
  } finally {
    await api.dispose();
  }
}

export default async function globalSetup(): Promise<void> {
  loadQaEnv();
  registerSecrets([process.env.QA_ADMIN_PASSWORD, process.env.QA_VIEWER_PASSWORD]);

  const probe = await request.newContext({ baseURL: baseURL() });
  try {
    const response = await probe.get("/login");
    if (!response.ok()) {
      throw new Error(
        `QA target ${baseURL()} answered ${response.status()} on /login. Start the hub (npm run dev) before running the Playwright suite.`,
      );
    }
  } catch (error) {
    throw new Error(
      `QA target ${baseURL()} is not reachable. Start the hub (npm run dev) or set QA_BASE_URL. Underlying error: ${
        error instanceof Error ? error.message : "unknown"
      }`,
    );
  } finally {
    await probe.dispose();
  }

  const admin = adminCredentials();
  if (!admin) {
    throw new Error(
      "QA_ADMIN_USERNAME / QA_ADMIN_PASSWORD are not configured. Add them to .env.qa (see .env.example).",
    );
  }

  mkdirSync(AUTH_DIR, { recursive: true });
  // A fresh source address per run: the hub rate-limits logins per client
  // address, and the setup login must not inherit a previous run's counter.
  const runPrefix = `10.${60 + Math.floor(Math.random() * 30)}.${1 + Math.floor(Math.random() * 200)}`;
  await saveState(admin, ADMIN_STATE, `${runPrefix}.2`);

  const viewer = viewerCredentials();
  if (viewer) {
    await saveState(viewer, VIEWER_STATE, `${runPrefix}.3`);
  } else {
    // Not a failure: the VIEWER specs report themselves as skipped instead.
    console.warn("[qa] QA_VIEWER_USERNAME / QA_VIEWER_PASSWORD not set — VIEWER role tests will be skipped.");
  }
}
