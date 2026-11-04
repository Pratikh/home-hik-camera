import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  MEDIAMTX_NETWORK,
  MEDIAMTX_WORKER_USER,
  mediamtxUsers,
  renderMediamtxConfig,
} from "../../../scripts/render-mediamtx-config.mjs";
import { redactLogLine } from "../../../scripts/mediamtx-log-redact.mjs";
import { mediamtxAuthHeaders, mediamtxAuthorizationHeader } from "@/server/video/mediamtx-auth";

const AUTH = "mediamtx-read-credential-0123456789";

function blockFor(yaml: string, marker: string): string {
  const start = yaml.indexOf(marker);
  expect(start).toBeGreaterThanOrEqual(0);
  const next = yaml.indexOf("\n  - user:", start + marker.length);
  return next === -1 ? yaml.slice(start) : yaml.slice(start, next);
}

describe("MediaMTX control-plane authentication", () => {
  it("renders no anonymous user in production and binds the API to the hub", () => {
    const yaml = renderMediamtxConfig({ MEDIAMTX_AUTH_PASSWORD: AUTH });
    expect(yaml).not.toContain("  - user: any");
    expect(yaml).not.toContain("DEVELOPMENT ONLY");

    const hub = blockFor(yaml, "  - user: hub");
    expect(hub).toContain(`    pass: "${AUTH}"`);
    expect(hub).toContain(`    ips: ["${MEDIAMTX_NETWORK.hub}/32"]`);
    expect(hub).toContain("      - action: read");
    expect(hub).toContain("      - action: playback");
    expect(hub).toContain("      - action: api");
  });

  it("gives the object worker a separate read-only account bound to its address", () => {
    const yaml = renderMediamtxConfig({ MEDIAMTX_AUTH_PASSWORD: AUTH });
    const worker = blockFor(yaml, `  - user: ${MEDIAMTX_WORKER_USER}`);
    expect(worker).toContain(`    ips: ["${MEDIAMTX_NETWORK.objectWorker}/32"]`);
    expect(worker).toContain("      - action: read");
    expect(worker).not.toContain("action: api");
    expect(worker).not.toContain("action: playback");
    expect(worker).not.toContain("action: publish");
  });

  it("keeps the explicit development anonymous escape hatch separate", () => {
    const yaml = renderMediamtxConfig({ MEDIAMTX_ALLOW_ANONYMOUS: "true" });
    expect(yaml).toContain("DEVELOPMENT ONLY: MEDIAMTX_ALLOW_ANONYMOUS=true");
    expect(yaml).toContain("  - user: any");
    // Anonymous mode is the only mode that grants API without credentials.
    expect(mediamtxUsers({ MEDIAMTX_ALLOW_ANONYMOUS: "true" }).join("\n")).toContain("action: api");
  });

  it("refuses to reuse the worker username for the hub account", () => {
    expect(() =>
      renderMediamtxConfig({ MEDIAMTX_AUTH_PASSWORD: AUTH, MEDIAMTX_AUTH_USER: MEDIAMTX_WORKER_USER }),
    ).toThrow(/MEDIAMTX_AUTH_USER/);
  });

  it("sends the hub credential to the Control API and nothing when unset", () => {
    const saved = { user: process.env.MEDIAMTX_AUTH_USER, password: process.env.MEDIAMTX_AUTH_PASSWORD };
    try {
      process.env.MEDIAMTX_AUTH_USER = "hub";
      process.env.MEDIAMTX_AUTH_PASSWORD = AUTH;
      const header = mediamtxAuthorizationHeader();
      expect(header).toBe(`Basic ${Buffer.from(`hub:${AUTH}`).toString("base64")}`);
      expect(mediamtxAuthHeaders()).toEqual({ Authorization: header });

      delete process.env.MEDIAMTX_AUTH_PASSWORD;
      expect(mediamtxAuthorizationHeader()).toBeNull();
      expect(mediamtxAuthHeaders()).toEqual({});
    } finally {
      if (saved.user === undefined) delete process.env.MEDIAMTX_AUTH_USER;
      else process.env.MEDIAMTX_AUTH_USER = saved.user;
      if (saved.password === undefined) delete process.env.MEDIAMTX_AUTH_PASSWORD;
      else process.env.MEDIAMTX_AUTH_PASSWORD = saved.password;
    }
  });
});

describe("MediaMTX log redaction", () => {
  afterEach(() => {
    // no shared state; kept for symmetry with the process.env test above
  });

  it("redacts RTSP and HTTP credentials before they reach the container log", () => {
    const line =
      '[path cam1_main] [source] failed: rtsp://admin:s3cret-pass@192.168.1.200:554/Streaming/Channels/102';
    const redacted = redactLogLine(line);
    expect(redacted).not.toContain("s3cret-pass");
    expect(redacted).not.toContain("admin:");
    expect(redacted).toContain("rtsp://[redacted]@192.168.1.200:554");
  });

  it("redacts Authorization headers and rendered YAML passwords", () => {
    expect(redactLogLine("Authorization: Basic dXNlcjpwYXNz")).not.toContain("dXNlcjpwYXNz");
    expect(redactLogLine('    pass: "hunter2"')).not.toContain("hunter2");
  });

  it("leaves ordinary log lines untouched", () => {
    const line = "[path cam1_main] [RTSP source] ready: 1 track (H264)";
    expect(redactLogLine(line)).toBe(line);
    expect(redactLogLine("")).toBe("");
  });
});

describe("compose network separation matches the rendered MediaMTX constants", () => {
  const compose = readFileSync("compose.yml", "utf8");

  it("uses the same static addresses and internal media network", () => {
    expect(compose).toContain(`subnet: ${MEDIAMTX_NETWORK.subnet}`);
    expect(compose).toContain(`ipv4_address: ${MEDIAMTX_NETWORK.hub}`);
    expect(compose).toContain(`ipv4_address: ${MEDIAMTX_NETWORK.mediamtx}`);
    expect(compose).toContain(`ipv4_address: ${MEDIAMTX_NETWORK.objectWorker}`);
    expect(compose).toMatch(/media:\s*\n\s+driver: bridge\s*\n\s+internal: true/);
  });

  it("keeps the face worker off every network and gives workers no egress", () => {
    expect(compose).toContain('network_mode: "none"');
    const objectWorker = compose.slice(compose.indexOf("  object-worker:"), compose.indexOf("  face-worker:"));
    expect(objectWorker).not.toContain("egress");
    expect(objectWorker).toContain(`ipv4_address: ${MEDIAMTX_NETWORK.objectWorker}`);
  });

  it("uses the dedicated worker MediaMTX account and an authenticated healthcheck", () => {
    expect(compose).toContain('MEDIAMTX_AUTH_USER: "${MEDIAMTX_WORKER_USER:-worker}"');
    expect(compose).toContain('test: ["CMD", "node", "/usr/local/bin/healthcheck.mjs"]');
    const healthcheck = readFileSync("mediamtx/healthcheck.mjs", "utf8");
    expect(healthcheck).toContain("Authorization");
    expect(healthcheck).toContain("MEDIAMTX_AUTH_PASSWORD");
  });

  it("runs the MediaMTX binary through the redacting wrapper", () => {
    expect(readFileSync("mediamtx/entrypoint.sh", "utf8")).toContain("run-mediamtx.mjs");
    expect(readFileSync("mediamtx/Dockerfile", "utf8")).toContain("run-mediamtx.mjs");
    expect(readFileSync("scripts/run-mediamtx.mjs", "utf8")).toContain("redactLogLine");
  });
});
