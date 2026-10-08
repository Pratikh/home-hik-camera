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
  const lines = [
    "# Generated at startup from environment variables.",
    "logLevel: info",
    "api: true",
    "apiAddress: :9997",
    "rtsp: false",
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
    ...(String(env.MEDIAMTX_AUTH_PASSWORD || "").trim()
      ? [
          "  - user: hub",
          `    pass: ${yamlString(String(env.MEDIAMTX_AUTH_PASSWORD).trim())}`,
          "    ips: []",
          "    permissions:",
          "      - action: read",
          "      - action: playback",
        ]
      : [
          "  - user: any",
          "    pass: ''",
          "    ips: []",
          "    permissions:",
          "      - action: read",
          "      - action: playback",
        ]),
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
  const yaml = renderMediamtxConfig(process.env);
  if (process.env.MEDIAMTX_CONFIG_STDOUT === "1") {
    process.stdout.write(yaml);
  } else {
    const output = process.env.MEDIAMTX_CONFIG_OUT || "mediamtx/runtime.yml";
    mkdirSync(dirname(output), { recursive: true });
    writeFileSync(output, yaml, { mode: 0o600 });
    console.error(`Wrote ${output}`);
  }
}
