import "server-only";

export type Env = Record<string, string | undefined>;

export type AppConfig = {
  appErrors: string[];
  appConfigured: boolean;
  appUsername: string;
  appPassword: string;
  sessionSecret: string;
  cookieSecure: boolean;
  dvrHost: string;
  dvrHttpPort: number;
  dvrRtspPort: number;
  dvrUsername: string;
  dvrPassword: string;
  dvrConfigured: boolean;
  dvrErrors: string[];
  mediamtxApiUrl: string;
  mediamtxWhepUrl: string;
  mediamtxHlsUrl: string;
  webrtcAdditionalHosts: string[];
  videoDevPlaceholder: boolean;
  dataDir: string;
  eventPollIntervalMs: number;
  eventRetentionDays: number;
  aiEnabled: boolean;
  eventDevMock: boolean;
  mediamtxAuthUser: string;
  mediamtxAuthPassword: string;
};

function cleanUrl(value: string | undefined, fallback: string): string {
  const raw = (value ?? "").trim() || fallback;
  return raw.replace(/\/+$/g, "");
}

function readPort(value: string | undefined, fallback: number, errors: string[], name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    errors.push(`${name} must be a port from 1 to 65535`);
    return fallback;
  }
  return parsed;
}

export function readConfig(env: Env): AppConfig {
  const appErrors: string[] = [];
  const dvrErrors: string[] = [];
  const appUsername = (env.APP_USERNAME ?? "").trim();
  const appPassword = env.APP_PASSWORD ?? "";
  const sessionSecret = (env.SESSION_SECRET ?? "").trim();

  if (!appUsername) appErrors.push("APP_USERNAME is required");
  if (!appPassword) appErrors.push("APP_PASSWORD is required");
  if (!sessionSecret) appErrors.push("SESSION_SECRET is required");
  else if (sessionSecret.length < 16) appErrors.push("SESSION_SECRET must be at least 16 characters");

  const dvrHost = (env.DVR_HOST || env.HIKVISION_IP || "").trim();
  const dvrUsername = (env.DVR_USERNAME || env.HIKVISION_USERNAME || "").trim();
  const dvrPassword = env.DVR_PASSWORD ?? env.HIKVISION_PASSWORD ?? "";
  const dvrHttpPort = readPort(env.DVR_HTTP_PORT, 80, dvrErrors, "DVR_HTTP_PORT");
  const dvrRtspPort = readPort(env.DVR_RTSP_PORT, 554, dvrErrors, "DVR_RTSP_PORT");
  const dvrConfigured = Boolean(dvrHost && dvrUsername && dvrPassword) && dvrErrors.length === 0;

  const webrtcAdditionalHosts = (env.WEBRTC_ADDITIONAL_HOST ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return {
    appErrors,
    appConfigured: appErrors.length === 0,
    appUsername,
    appPassword,
    sessionSecret,
    cookieSecure: (env.COOKIE_SECURE ?? "").trim().toLowerCase() === "true",
    dvrHost,
    dvrHttpPort,
    dvrRtspPort,
    dvrUsername,
    dvrPassword,
    dvrConfigured,
    dvrErrors,
    mediamtxApiUrl: cleanUrl(env.MEDIAMTX_API_URL, "http://127.0.0.1:9997"),
    mediamtxWhepUrl: cleanUrl(env.MEDIAMTX_WHEP_URL, "http://127.0.0.1:8889"),
    mediamtxHlsUrl: cleanUrl(env.MEDIAMTX_HLS_URL, "http://127.0.0.1:8888"),
    webrtcAdditionalHosts,
    videoDevPlaceholder: (env.VIDEO_DEV_PLACEHOLDER ?? "").trim().toLowerCase() === "true",
    dataDir: (env.DATA_DIR ?? "").trim() || "data",
    eventPollIntervalMs: readBoundedInt(env.EVENT_POLL_INTERVAL_MS, 5000, 1000, 300000),
    eventRetentionDays: readBoundedInt(env.EVENT_RETENTION_DAYS, 30, 0, 3650),
    aiEnabled: (env.AI_ENABLED ?? "").trim().toLowerCase() === "true",
    eventDevMock: (env.NODE_ENV ?? "") !== "production" && (env.EVENT_DEV_MOCK ?? "").trim().toLowerCase() === "true",
    mediamtxAuthUser: (env.MEDIAMTX_AUTH_USER ?? "hub").trim() || "hub",
    mediamtxAuthPassword: env.MEDIAMTX_AUTH_PASSWORD ?? "",
  };
}

function readBoundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
}

export function getConfig(): AppConfig {
  return readConfig(process.env);
}
