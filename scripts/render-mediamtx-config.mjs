import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

export function cameraStreamPlan() {
  const plan = [];
  for (let id = 1; id <= 4; id += 1) {
    plan.push({
      id,
      mainChannel: id * 100 + 1,
      subChannel: id * 100 + 2,
      mainPath: `cam${id}_main`,
      subPath: `cam${id}_sub`,
    });
  }
  return plan;
}

function isSafeHost(host) {
  return host.length > 0 && host.length <= 253 && /^[A-Za-z0-9._:-]+$/.test(host);
}

function yamlString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function rtspSource(env, channel) {
  const host = String(env.DVR_HOST || env.HIKVISION_IP || "").trim();
  const username = String(env.DVR_USERNAME || env.HIKVISION_USERNAME || "");
  const password = String(env.DVR_PASSWORD ?? env.HIKVISION_PASSWORD ?? "");
  const port = String(env.DVR_RTSP_PORT || "554").trim();
  if (!host || !username || !password) return null;
  if (!isSafeHost(host)) {
    console.error("[mediamtx] DVR host failed validation");
    return null;
  }
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
    console.error("[mediamtx] DVR RTSP port failed validation");
    return null;
  }
  const hostPart = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `rtsp://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${hostPart}:${port}/Streaming/Channels/${channel}`;
}

function additionalHosts(env) {
  const extra = String(env.WEBRTC_ADDITIONAL_HOST || "")
    .split(",")
    .map((item) => item.trim())
    .filter((item) => isSafeHost(item));
  return [...new Set(["127.0.0.1", ...extra])];
}

/**
 * MediaMTX credentials are required.
 *
 * Removing the host port publications is not enough on its own: anything that
 * can reach the container network (a stray container, a misconfigured publish,
 * the host loopback during development) must still be rejected without the
 * password. `MEDIAMTX_ALLOW_ANONYMOUS=true` is an explicit development-only
 * escape hatch; production never sets it.
 */
export function mediamtxAuth(env) {
  const allowAnonymous = String(env.MEDIAMTX_ALLOW_ANONYMOUS || "").trim().toLowerCase() === "true";
  const password = String(env.MEDIAMTX_AUTH_PASSWORD || "").trim();
  const user = String(env.MEDIAMTX_AUTH_USER || "hub").trim() || "hub";
  if (!allowAnonymous && !password) {
    throw new Error(
      "MEDIAMTX_AUTH_PASSWORD is required. Generate one with `openssl rand -base64 32`, " +
        "put it in .env, and recreate MediaMTX. Set MEDIAMTX_ALLOW_ANONYMOUS=true only for local development.",
    );
  }
  if (password && password.length < 16) {
    throw new Error("MEDIAMTX_AUTH_PASSWORD must be at least 16 characters.");
  }
  if (!/^[A-Za-z0-9._-]{1,64}$/.test(user)) {
    throw new Error("MEDIAMTX_AUTH_USER must be 1-64 characters of A-Z a-z 0-9 . _ -");
  }
  return { user, password, allowAnonymous };
}

function pathBlock(name, source) {
  if (!source) {
    return [`  ${name}:`, "    source: publisher"].join("\n");
  }
  return [
    `  ${name}:`,
    `    source: ${yamlString(source)}`,
    "    sourceOnDemand: true",
    "    sourceOnDemandStartTimeout: 20s",
    "    sourceOnDemandCloseAfter: 10s",
    "    rtspTransport: tcp",
  ].join("\n");
}

export function renderMediamtxConfig(env) {
  const hosts = additionalHosts(env);
  const auth = mediamtxAuth(env);
  const readUser = auth.password
    ? [
        `  - user: ${auth.user}`,
        `    pass: ${yamlString(auth.password)}`,
        "    ips: []",
        "    permissions:",
        "      - action: read",
        "      - action: playback",
      ]
    : [
        "# DEVELOPMENT ONLY: MEDIAMTX_ALLOW_ANONYMOUS=true. Never use in production.",
        "  - user: any",
        "    pass: ''",
        "    ips: []",
        "    permissions:",
        "      - action: read",
        "      - action: playback",
      ];
  const lines = [
    "# Generated at startup from environment variables.",
    "logLevel: info",
    "api: true",
    "apiAddress: :9997",
    // The RTSP listener stays internal to the compose network. It is not
    // published (only 8189/WebRTC is), but the local object-detection worker
    // reads the H.264 substreams through it: MediaMTX's HLS authentication uses
    // a browser cookie handshake that FFmpeg/OpenCV cannot complete, while RTSP
    // credentials work directly and keep the worker off the DVR.
    "rtsp: true",
    "rtspAddress: :8554",
    "rtmp: false",
    "hls: true",
    "hlsAddress: :8888",
    "hlsVariant: mpegts",
    "hlsSegmentDuration: 1s",
    "hlsAllowOrigins: ['*']",
    "webrtc: true",
    "webrtcAddress: :8889",
    "webrtcAllowOrigins: ['*']",
    "webrtcLocalUDPAddress: :8189",
    "webrtcLocalTCPAddress: :8189",
    "webrtcIPsFromInterfaces: false",
    `webrtcAdditionalHosts: [${hosts.map((host) => yamlString(host)).join(", ")}]`,
    "webrtcHandshakeTimeout: 20s",
    "webrtcTrackGatherTimeout: 15s",
    "srt: false",
    "moq: false",
    "playback: false",
    "metrics: false",
    "pprof: false",
    "authMethod: internal",
    "authInternalUsers:",
    ...readUser,
    "  # The MediaMTX API is reachable only on the internal compose network. It",
    "  # is used by the hub to publish the playback source.",
    "  - user: any",
    "    pass: ''",
    "    ips: []",
    "    permissions:",
    "      - action: api",
    "paths:",
  ];

  for (const camera of cameraStreamPlan()) {
    lines.push(pathBlock(camera.subPath, rtspSource(env, camera.subChannel)));
    lines.push(pathBlock(camera.mainPath, rtspSource(env, camera.mainChannel)));
  }
  lines.push("  all_others:", "    source: publisher", "");
  return `${lines.join("\n")}\n`;
}

function isDirectRun() {
  const entry = process.argv[1];
  if (!entry) return false;
  return import.meta.url === pathToFileURL(entry).href;
}

if (isDirectRun()) {
  let yaml;
  try {
    yaml = renderMediamtxConfig(process.env);
  } catch (error) {
    // The message is configuration guidance only; it never contains a secret.
    console.error(`[mediamtx] ${error instanceof Error ? error.message : "invalid configuration"}`);
    process.exit(1);
  }
  if (process.env.MEDIAMTX_CONFIG_STDOUT === "1") {
    process.stdout.write(yaml);
  } else {
    const output = process.env.MEDIAMTX_CONFIG_OUT || "mediamtx/runtime.yml";
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, yaml, { mode: 0o600 });
    console.error(`Wrote ${output}`);
  }
}
