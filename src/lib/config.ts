import "server-only";

import { DEFAULT_FACE_TEST_COOLDOWN_SECONDS } from "@/lib/faces";

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
  /** Face detection is opt-in and off by default. */
  faceDetectionEnabled: boolean;
  /** Detections below this score are discarded. Never hardcoded in logic. */
  faceDetectionConfidence: number;
  /** Upper bound on faces stored per snapshot; the strongest are kept. */
  faceDetectionMaxFaces: number;
  /** Temporary face-notification test mode. Off unless explicitly enabled. */
  faceDetectionTestNotifications: boolean;
  /** Per-camera cooldown for the test notifications, in seconds. */
  faceDetectionTestNotificationCooldownSeconds: number;
  /** ISO-8601 expiry with an explicit offset; empty when unset. */
  faceDetectionTestUntil: string;
  /**
   * Telegram notifications. Server-side only: the token and chat id are never
   * sent to the browser, never returned by an API and never logged.
   */
  telegramNotificationsEnabled: boolean;
  telegramBotToken: string;
  telegramChatId: string;
  /** Whether face detections may produce a Telegram message. */
  telegramFaceNotifications: boolean;
  /**
   * Accepted for compatibility with the documented environment. Telegram does
   * NOT apply its own cooldown: the face notification cooldown is the existing
   * `faceDetectionTestNotificationCooldownSeconds`, and a suppressed face
   * decision suppresses Telegram too.
   */
  telegramCooldownSeconds: number;
  /** Attach the existing face crop to the Telegram notification. */
  telegramFaceImage: boolean;
  /** Attach a short CCTV clip around the event. */
  telegramFaceVideo: boolean;
  /** Seconds of footage before the event timestamp. */
  telegramVideoPreSeconds: number;
  /** Seconds of footage after the event timestamp. */
  telegramVideoPostSeconds: number;
  /** FFmpeg executable used for the clip conversion. Never bundled. */
  ffmpegPath: string;
  /** App-level cap for the clip upload, kept below Telegram's own bot limit. */
  telegramVideoMaxMb: number;
  /** How long FFmpeg may run for one clip before it is killed. */
  telegramVideoTimeoutSeconds: number;
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
    faceDetectionEnabled: (env.FACE_DETECTION_ENABLED ?? "").trim().toLowerCase() === "true",
    faceDetectionConfidence: readFloat(env.FACE_DETECTION_CONFIDENCE, DEFAULT_FACE_CONFIDENCE, 0, 1),
    faceDetectionMaxFaces: readBoundedInt(env.FACE_DETECTION_MAX_FACES, DEFAULT_FACE_MAX_FACES, 1, 100),
    faceDetectionTestNotifications:
      (env.FACE_DETECTION_TEST_NOTIFICATIONS ?? "").trim().toLowerCase() === "true",
    faceDetectionTestNotificationCooldownSeconds: readBoundedInt(
      env.FACE_DETECTION_TEST_NOTIFICATION_COOLDOWN_SECONDS,
      DEFAULT_FACE_TEST_COOLDOWN_SECONDS,
      0,
      86_400,
    ),
    faceDetectionTestUntil: (env.FACE_DETECTION_TEST_UNTIL ?? "").trim(),
    telegramNotificationsEnabled: (env.TELEGRAM_NOTIFICATIONS_ENABLED ?? "").trim().toLowerCase() === "true",
    telegramBotToken: (env.TELEGRAM_BOT_TOKEN ?? "").trim(),
    telegramChatId: (env.TELEGRAM_CHAT_ID ?? "").trim(),
    telegramFaceNotifications: (env.TELEGRAM_FACE_NOTIFICATIONS ?? "").trim().toLowerCase() === "true",
    telegramCooldownSeconds: readBoundedInt(
      env.TELEGRAM_COOLDOWN_SECONDS,
      DEFAULT_TELEGRAM_COOLDOWN_SECONDS,
      0,
      86_400,
    ),
    // These default to ON: the face image and clip are the point of the media
    // notification, and Telegram itself is still off unless explicitly enabled.
    telegramFaceImage: readBool(env.TELEGRAM_FACE_IMAGE, true),
    telegramFaceVideo: readBool(env.TELEGRAM_FACE_VIDEO, true),
    telegramVideoPreSeconds: readBoundedInt(env.TELEGRAM_VIDEO_PRE_SECONDS, DEFAULT_VIDEO_PRE_SECONDS, 0, 60),
    telegramVideoPostSeconds: readBoundedInt(env.TELEGRAM_VIDEO_POST_SECONDS, DEFAULT_VIDEO_POST_SECONDS, 0, 60),
    ffmpegPath: (env.FFMPEG_PATH ?? "").trim() || "ffmpeg",
    telegramVideoMaxMb: readBoundedInt(env.TELEGRAM_VIDEO_MAX_MB, DEFAULT_VIDEO_MAX_MB, 1, 49),
    telegramVideoTimeoutSeconds: readBoundedInt(
      env.TELEGRAM_VIDEO_TIMEOUT_SECONDS,
      DEFAULT_VIDEO_TIMEOUT_SECONDS,
      5,
      300,
    ),
  };
}

export const DEFAULT_FACE_CONFIDENCE = 0.6;
export const DEFAULT_FACE_MAX_FACES = 10;
export const DEFAULT_TELEGRAM_COOLDOWN_SECONDS = 300;
export const DEFAULT_VIDEO_PRE_SECONDS = 5;
export const DEFAULT_VIDEO_POST_SECONDS = 5;
/** Telegram's own bot upload limit for sendVideo is 50 MB; stay under it. */
export const DEFAULT_VIDEO_MAX_MB = 45;
export const DEFAULT_VIDEO_TIMEOUT_SECONDS = 30;

/**
 * A flag that can default to either value.
 *
 * The Telegram master switches stay fail-closed (absent means off), but the
 * media attachments default to on, so "unset" must be distinguishable from
 * "explicitly false".
 */
function readBool(value: string | undefined, fallback: boolean): boolean {
  const parsed = (value ?? "").trim().toLowerCase();
  if (parsed === "true") return true;
  if (parsed === "false") return false;
  return fallback;
}

/**
 * A confidence threshold outside 0..1 is meaningless; fall back rather than
 * failing the whole application configuration over an optional feature.
 */
function readFloat(value: string | undefined, fallback: number, min: number, max: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return fallback;
  return parsed;
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
