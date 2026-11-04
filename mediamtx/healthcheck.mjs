#!/usr/bin/env node
/**
 * Authenticated liveness probe for the MediaMTX Control API.
 *
 * The API rejects anonymous clients (Phase 3), so the probe authenticates with
 * the same hub credential the app uses. Both values come from the container
 * environment; the password is never placed on a command line (process arguments
 * are visible to every process in the container, environment variables are not).
 *
 * Node is already in the image (it renders the config), so this avoids depending
 * on a `wget` that understands `--header`.
 */
const url = process.env.MEDIAMTX_HEALTH_URL || "http://127.0.0.1:9997/v3/paths/list";
const user = process.env.MEDIAMTX_AUTH_USER;
const password = process.env.MEDIAMTX_AUTH_PASSWORD;

if (!user || !password) {
  console.error("[healthcheck] MEDIAMTX_AUTH_USER and MEDIAMTX_AUTH_PASSWORD are required");
  process.exit(1);
}

const authorization = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 2500);
try {
  const response = await fetch(url, { headers: { Authorization: authorization }, signal: controller.signal });
  process.exit(response.ok ? 0 : 1);
} catch {
  process.exit(1);
} finally {
  clearTimeout(timer);
}
