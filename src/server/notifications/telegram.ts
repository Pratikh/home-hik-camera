import "server-only";
import { getConfig, type AppConfig } from "@/lib/config";

/**
 * Telegram notifications — server-side only.
 *
 * The bot token lives in the server environment and is used to build the Bot API
 * URL. That URL contains the token, so it is never logged, never returned by an
 * API and never placed in an SSE payload or the client bundle. Only the
 * structured result and a redacted description ever leave this module.
 *
 * Everything here is fail-safe: a Telegram outage logs a line and returns a
 * failure. It never throws into the event or face pipeline.
 */

export const TELEGRAM_API_BASE = "https://api.telegram.org";
export const DEFAULT_TELEGRAM_TIMEOUT_MS = 5000;
/** Telegram rejects messages longer than 4096 characters. */
const TELEGRAM_MAX_TEXT = 4096;
/** Bot upload limits, as documented by Telegram. */
export const TELEGRAM_MAX_PHOTO_BYTES = 10 * 1024 * 1024;
export const TELEGRAM_MAX_VIDEO_BYTES = 50 * 1024 * 1024;
/** sendMediaGroup accepts at most 10 items. */
export const TELEGRAM_MAX_MEDIA_GROUP_ITEMS = 10;

export type TelegramFailureReason =
  | "disabled"
  | "not_configured"
  | "invalid_chat_id"
  | "http_error"
  | "timeout"
  | "network_error"
  | "invalid_text"
  | "file_missing"
  | "file_too_large"
  | "invalid_file";

export type TelegramResult =
  | { ok: true; status: "sent" }
  | { ok: false; status: TelegramFailureReason; detail: string | null };

/** Configuration view of Telegram, with the secrets already reduced to booleans. */
export type TelegramConfig = Pick<
  AppConfig,
  | "telegramNotificationsEnabled"
  | "telegramBotToken"
  | "telegramChatId"
  | "telegramFaceNotifications"
  | "telegramEventNotifications"
>;

export type TelegramState = {
  /** TELEGRAM_NOTIFICATIONS_ENABLED. */
  enabled: boolean;
  /** Token and chat id are both present. */
  configured: boolean;
  /** Enabled, configured and allowed for face detections. */
  faceReady: boolean;
  /** Enabled, configured and allowed for general notification rules. */
  eventReady: boolean;
  reason: TelegramFailureReason | null;
};

/**
 * Escape the three characters Telegram's HTML parse mode treats as markup.
 *
 * The ampersand must be replaced first, or the escapes introduced for `<` and
 * `>` would themselves be escaped again.
 */
/**
 * Escape the three characters Telegram's HTML parse mode treats as markup.
 *
 * The ampersand must be replaced first, or the escapes introduced for `<` and
 * `>` would themselves be escaped again.
 */
export function escapeTelegramHtml(value: string): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

/**
 * "23 Oct 2026, 06:34 PM" in India time, the zone the whole application uses.
 * Built from parts so the day/month order and the AM/PM casing are fixed.
 */
export function formatTelegramTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "unknown time";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const bag: Record<string, string> = {};
  for (const part of parts) if (part.type !== "literal") bag[part.type] = part.value;
  const period = (bag.dayPeriod ?? "").toUpperCase();
  return `${bag.day} ${bag.month} ${bag.year}, ${bag.hour}:${bag.minute}${period ? ` ${period}` : ""}`;
}

/** What the media notification is about; drives the caption title. */
export type TelegramMediaKind = "person" | "vehicle" | "face";

const MEDIA_TITLES: Record<TelegramMediaKind, { emoji: string; title: string }> = {
  person: { emoji: "🚨", title: "Person detected" },
  vehicle: { emoji: "🚗", title: "Vehicle detected" },
  face: { emoji: "👤", title: "Face detected" },
};

/**
 * Caption for a media-only notification.
 *
 * Only safe metadata is rendered: the camera's display name, the event's own
 * timestamp (never the upload time) and the detector confidence. No path, id,
 * token or URL can reach this function.
 */
export function buildTelegramMediaCaption(input: {
  kind: TelegramMediaKind;
  cameraName: string;
  /** Stored event timestamp; rendered in India time. */
  eventTimestamp: string;
  /** 0–1, from the detector or the face detector; null when unknown. */
  confidence: number | null;
}): string {
  const title = MEDIA_TITLES[input.kind];
  const lines = [
    `${title.emoji} <b>${title.title}</b>`,
    "",
    `📹 Camera: ${escapeTelegramHtml(input.cameraName.trim() || "Camera")}`,
    `🕐 Time: ${escapeTelegramHtml(formatTelegramTime(input.eventTimestamp))}`,
  ];
  if (input.confidence !== null && Number.isFinite(input.confidence)) {
    const percent = Math.round(Math.min(1, Math.max(0, input.confidence)) * 100);
    lines.push(`🎯 Confidence: ${percent}%`);
  }
  return lines.join("\n");
}

/** The message the admin test endpoint sends. */
export function buildTelegramTestMessage(): string {
  return ["🏠 <b>Home CCTV Hub</b>", "", "Telegram notification test successful."].join("\n");
}

/**
 * True when the configured value cannot be a Telegram chat id.
 *
 * The common mistake is putting the *bot username* (or `@name`) in
 * TELEGRAM_CHAT_ID. `sendMessage` needs the numeric id of a chat that has
 * talked to the bot; a bot cannot message itself, so that always fails with
 * "chat not found".
 */
export function looksLikeInvalidChatId(value: string): boolean {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return false; // empty is reported as "not configured"
  if (trimmed.startsWith("@")) return true;
  return !/^-?\d+$/.test(trimmed);
}

export function telegramState(config: TelegramConfig = getConfig()): TelegramState {
  const enabled = config.telegramNotificationsEnabled;
  const configured = Boolean(config.telegramBotToken) && Boolean(config.telegramChatId);
  if (!enabled) return { enabled, configured, faceReady: false, eventReady: false, reason: "disabled" };
  if (!configured) return { enabled, configured, faceReady: false, eventReady: false, reason: "not_configured" };
  return {
    enabled,
    configured,
    faceReady: config.telegramFaceNotifications,
    eventReady: config.telegramEventNotifications,
    reason: config.telegramFaceNotifications ? null : "disabled",
  };
}

/** Remove anything that could carry the token out of a string we log or return. */
export function redactTelegramSecret(value: string, token: string): string {
  let out = String(value ?? "");
  if (token) out = out.split(token).join("[redacted]");
  return out;
}

export type SendTelegramInput = {
  text: string;
  config?: TelegramConfig;
  /** Injected in tests; never used to reach the real API in the suite. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  log?: (line: string) => void;
  /** When false, TELEGRAM_FACE_NOTIFICATIONS is not consulted (the test button). */
  requireFaceFlag?: boolean;
  /** When true, TELEGRAM_EVENT_NOTIFICATIONS must be enabled. */
  requireEventFlag?: boolean;
};

function logLine(message: string): void {
  console.info(`[telegram] ${message}`);
}

/** Everything needed to talk to the Bot API, after the secret checks. */
type Ready = { config: TelegramConfig; logger: (message: string) => void; fetchImpl: typeof fetch; timeoutMs: number };

/**
 * Validate configuration before any network call. Returns a failure result, or
 * the resolved settings. Shared by the text, photo, video and album senders so
 * the rules (and the log vocabulary) cannot drift apart.
 */
function preflight(input: {
  config?: TelegramConfig;
  log?: (message: string) => void;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  requireFaceFlag?: boolean;
  requireEventFlag?: boolean;
}): { ok: true; ready: Ready } | { ok: false; result: TelegramResult } {
  const config = input.config ?? getConfig();
  const logger = input.log ?? logLine;
  const state = telegramState(config);

  if (!state.enabled) {
    logger("disabled");
    return { ok: false, result: { ok: false, status: "disabled", detail: null } };
  }
  if (!state.configured) {
    logger("configuration missing");
    return { ok: false, result: { ok: false, status: "not_configured", detail: null } };
  }
  if (input.requireFaceFlag && !config.telegramFaceNotifications) {
    logger("disabled");
    return { ok: false, result: { ok: false, status: "disabled", detail: null } };
  }
  if (input.requireEventFlag && !config.telegramEventNotifications) {
    logger("disabled");
    return { ok: false, result: { ok: false, status: "disabled", detail: null } };
  }
  if (looksLikeInvalidChatId(config.telegramChatId)) {
    logger("configuration invalid");
    return { ok: false, result: { ok: false, status: "invalid_chat_id", detail: null } };
  }
  return {
    ok: true,
    ready: {
      config,
      logger,
      fetchImpl: input.fetchImpl ?? fetch,
      timeoutMs: input.timeoutMs ?? DEFAULT_TELEGRAM_TIMEOUT_MS,
    },
  };
}

/**
 * One POST to the Bot API, with a timeout and safe error mapping.
 *
 * The URL carries the token, so it is never logged and never returned. A
 * Telegram error description is passed through `redactTelegramSecret` first.
 */
async function postTelegram(
  method: string,
  body: FormData | string,
  contentType: string | null,
  ready: Ready,
): Promise<TelegramResult> {
  const { config, logger, fetchImpl, timeoutMs } = ready;
  const url = `${TELEGRAM_API_BASE}/bot${config.telegramBotToken}/${method}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: contentType ? { "Content-Type": contentType } : undefined,
      body,
      signal: controller.signal,
    });
    /*
     * Telegram answers 200 with `{"ok":false}` for several refusals, so the body
     * decides success — not the HTTP status alone.
     */
    let parsed: { ok?: unknown; description?: unknown; result?: unknown } | null = null;
    try {
      parsed = (await response.json()) as { ok?: unknown; description?: unknown; result?: unknown };
    } catch {
      parsed = null;
    }

    const description =
      typeof parsed?.description === "string" && parsed.description.trim()
        ? redactTelegramSecret(parsed.description.trim(), config.telegramBotToken).slice(0, 200)
        : null;
    const accepted = response.ok && parsed?.ok === true && typeof parsed.result === "object" && parsed.result !== null;

    if (!accepted) {
      const detail = description
        ? `HTTP ${response.status}: ${description}`
        : parsed === null
          ? `HTTP ${response.status}: unreadable response`
          : `HTTP ${response.status}: ok=${String(parsed.ok)}`;
      logger("notification failed");
      return { ok: false, status: "http_error", detail };
    }
    logger("notification sent");
    return { ok: true, status: "sent" };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    logger("notification failed");
    return {
      ok: false,
      status: aborted ? "timeout" : "network_error",
      detail: aborted ? `no response within ${timeoutMs} ms` : "request failed",
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Send one message. Never throws.
 *
 * The failure `detail` is a status code or a redacted Telegram description —
 * never the request URL, the token or the request body.
 */
export async function sendTelegramMessage(input: SendTelegramInput): Promise<TelegramResult> {
  const check = preflight(input);
  if (!check.ok) return check.result;
  const { ready } = check;

  const text = String(input.text ?? "");
  if (!text.trim()) {
    ready.logger("notification failed");
    return { ok: false, status: "invalid_text", detail: null };
  }
  const body = text.length > TELEGRAM_MAX_TEXT ? `${text.slice(0, TELEGRAM_MAX_TEXT - 1)}…` : text;

  return postTelegram(
    "sendMessage",
    JSON.stringify({
      chat_id: ready.config.telegramChatId,
      text: body,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    }),
    "application/json",
    ready,
  );
}

/** Options for the file senders: no text body, no face-flag gate. */
export type TelegramSendOptions = Omit<SendTelegramInput, "text" | "requireFaceFlag">;

/** A file to upload. Bytes are held in memory only for the duration of a send. */
export type TelegramFile = {
  bytes: Uint8Array;
  filename: string;
  contentType: string;
};

function checkFile(file: TelegramFile, maxBytes: number): TelegramResult | null {
  if (!file || file.bytes.length === 0) return { ok: false, status: "file_missing", detail: null };
  if (file.bytes.length > maxBytes) {
    return { ok: false, status: "file_too_large", detail: `${file.bytes.length} bytes` };
  }
  return null;
}

function fileBlob(file: TelegramFile): Blob {
  // Copy into a fresh buffer: Blob does not accept a SharedArrayBuffer-backed view.
  return new Blob([new Uint8Array(file.bytes)], { type: file.contentType });
}

/** Upload the detected face crop. */
export async function sendTelegramPhoto(
  input: TelegramSendOptions & { photo: TelegramFile; caption?: string },
): Promise<TelegramResult> {
  const check = preflight(input);
  if (!check.ok) return check.result;
  const { ready } = check;

  const bad = checkFile(input.photo, TELEGRAM_MAX_PHOTO_BYTES);
  if (bad) {
    ready.logger("notification failed");
    return bad;
  }

  const form = new FormData();
  form.append("chat_id", ready.config.telegramChatId);
  if (input.caption) {
    form.append("caption", input.caption.slice(0, 1024));
    form.append("parse_mode", "HTML");
  }
  form.append("photo", fileBlob(input.photo), input.photo.filename);
  return postTelegram("sendPhoto", form, null, ready);
}

/** Upload one or more face crops as a single album. */
export async function sendTelegramMediaGroup(
  input: TelegramSendOptions & { photos: TelegramFile[]; caption?: string },
): Promise<TelegramResult> {
  const check = preflight(input);
  if (!check.ok) return check.result;
  const { ready } = check;

  const photos = input.photos.slice(0, TELEGRAM_MAX_MEDIA_GROUP_ITEMS);
  if (photos.length === 0) {
    ready.logger("notification failed");
    return { ok: false, status: "file_missing", detail: null };
  }
  for (const photo of photos) {
    const bad = checkFile(photo, TELEGRAM_MAX_PHOTO_BYTES);
    if (bad) {
      ready.logger("notification failed");
      return bad;
    }
  }

  const form = new FormData();
  form.append("chat_id", ready.config.telegramChatId);
  form.append(
    "media",
    JSON.stringify(
      photos.map((photo, index) => ({
        type: "photo",
        media: `attach://photo${index}`,
        ...(index === 0 && input.caption
          ? { caption: input.caption.slice(0, 1024), parse_mode: "HTML" }
          : {}),
      })),
    ),
  );
  photos.forEach((photo, index) => form.append(`photo${index}`, fileBlob(photo), photo.filename));
  return postTelegram("sendMediaGroup", form, null, ready);
}

/** Upload the short event clip. */
export async function sendTelegramVideo(
  input: TelegramSendOptions & { video: TelegramFile; caption?: string },
): Promise<TelegramResult> {
  const check = preflight(input);
  if (!check.ok) return check.result;
  const { ready } = check;

  const bad = checkFile(input.video, TELEGRAM_MAX_VIDEO_BYTES);
  if (bad) {
    ready.logger("notification failed");
    return bad;
  }

  const form = new FormData();
  form.append("chat_id", ready.config.telegramChatId);
  form.append("supports_streaming", "true");
  if (input.caption) {
    form.append("caption", input.caption.slice(0, 1024));
    form.append("parse_mode", "HTML");
  }
  form.append("video", fileBlob(input.video), input.video.filename);
  return postTelegram("sendVideo", form, null, ready);
}

/** A safe, user-facing sentence for the admin test endpoint. */
export function telegramFailureMessage(result: TelegramResult): string {
  if (result.ok) return "Telegram test message sent.";
  switch (result.status) {
    case "disabled":
      return "Telegram notifications are disabled (set TELEGRAM_NOTIFICATIONS_ENABLED=true on the server).";
    case "not_configured":
      return "Telegram is not configured: TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must both be set on the server.";
    case "invalid_chat_id":
      return "TELEGRAM_CHAT_ID is not a chat id. It must be the numeric id of your chat with the bot (a bot username does not work). Message the bot on Telegram first, then read the id from getUpdates.";
    case "timeout":
      return "Telegram did not respond in time.";
    case "http_error":
      return `Telegram rejected the message (${result.detail ?? "HTTP error"}).`;
    case "invalid_text":
      return "The message was empty.";
    default:
      return "Telegram could not be reached.";
  }
}
