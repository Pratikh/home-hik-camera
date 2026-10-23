import { describe, expect, it, vi } from "vitest";
import {
  TELEGRAM_API_BASE,
  TELEGRAM_MAX_VIDEO_BYTES,
  buildTelegramMediaCaption,
  escapeTelegramHtml,
  formatTelegramTime,
  looksLikeInvalidChatId,
  sendTelegramMediaGroup,
  sendTelegramPhoto,
  sendTelegramVideo,
  type TelegramFile,
  buildTelegramTestMessage,
  redactTelegramSecret,
  sendTelegramMessage,
  telegramFailureMessage,
  telegramState,
  type TelegramConfig,
} from "@/server/notifications/telegram";

/**
 * TELEGRAM-001 … TELEGRAM-011 and TELEGRAM-018.
 *
 * Every test injects a fake `fetch`, so the suite never contacts Telegram and
 * never needs a real bot. The token below is an obvious fake.
 */

const FAKE_TOKEN = "111111:AAAfake-test-token-value";
const FAKE_CHAT_ID = "-1001234567890";

const CONFIG: TelegramConfig = {
  telegramNotificationsEnabled: true,
  telegramBotToken: FAKE_TOKEN,
  telegramChatId: FAKE_CHAT_ID,
  telegramFaceNotifications: true,
  telegramEventNotifications: true,
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function okFetch() {
  return vi.fn(async () => jsonResponse(200, { ok: true, result: { message_id: 1 } }));
}

function requestBody(call: unknown[]): Record<string, unknown> {
  const init = call[1] as RequestInit;
  return JSON.parse(String(init.body)) as Record<string, unknown>;
}

describe("TELEGRAM-001 / 002 / 003 / 004 — when nothing may be sent", () => {
  it("TELEGRAM-001 sends no request while TELEGRAM_NOTIFICATIONS_ENABLED is false", async () => {
    const fetchImpl = okFetch();
    const log = vi.fn();
    const result = await sendTelegramMessage({
      text: "hello",
      config: { ...CONFIG, telegramNotificationsEnabled: false },
      fetchImpl,
      log,
    });

    expect(result).toEqual({ ok: false, status: "disabled", detail: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("disabled");
  });

  it("TELEGRAM-002 sends no request while TELEGRAM_FACE_NOTIFICATIONS is false", async () => {
    const fetchImpl = okFetch();
    const log = vi.fn();
    const result = await sendTelegramMessage({
      text: "hello",
      requireFaceFlag: true,
      config: { ...CONFIG, telegramFaceNotifications: false },
      fetchImpl,
      log,
    });

    expect(result).toEqual({ ok: false, status: "disabled", detail: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("disabled");
  });

  it("still allows the admin test message while face notifications are off", async () => {
    const fetchImpl = okFetch();
    const result = await sendTelegramMessage({
      text: buildTelegramTestMessage(),
      config: { ...CONFIG, telegramFaceNotifications: false },
      fetchImpl,
      log: () => undefined,
    });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("TELEGRAM-003 fails safely with no bot token", async () => {
    const fetchImpl = okFetch();
    const log = vi.fn();
    const result = await sendTelegramMessage({
      text: "hello",
      config: { ...CONFIG, telegramBotToken: "" },
      fetchImpl,
      log,
    });

    expect(result).toEqual({ ok: false, status: "not_configured", detail: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("configuration missing");
  });

  it("TELEGRAM-004 fails safely with no chat id", async () => {
    const fetchImpl = okFetch();
    const result = await sendTelegramMessage({
      text: "hello",
      config: { ...CONFIG, telegramChatId: "" },
      fetchImpl,
      log: () => undefined,
    });

    expect(result).toEqual({ ok: false, status: "not_configured", detail: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports the state without exposing a secret", () => {
    expect(telegramState(CONFIG)).toEqual({
      enabled: true,
      configured: true,
      faceReady: true,
      eventReady: true,
      reason: null,
    });
    expect(telegramState({ ...CONFIG, telegramNotificationsEnabled: false })).toMatchObject({
      enabled: false,
      reason: "disabled",
    });
    expect(telegramState({ ...CONFIG, telegramBotToken: "" })).toMatchObject({
      configured: false,
      faceReady: false,
      reason: "not_configured",
    });
    // The state object contains no token and no chat id.
    expect(JSON.stringify(telegramState(CONFIG))).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(telegramState(CONFIG))).not.toContain(FAKE_CHAT_ID);
  });
});

describe("TELEGRAM-007 — the admin test message", () => {
  it("formats the test message", () => {
    expect(buildTelegramTestMessage()).toBe(
      ["🏠 <b>Home CCTV Hub</b>", "", "Telegram notification test successful."].join("\n"),
    );
  });
});

describe("TELEGRAM-005 / 006 — the request Telegram receives", () => {
  it("posts sendMessage with the configured chat id, HTML text and a timeout", async () => {
    const fetchImpl = okFetch();
    const result = await sendTelegramMessage({
      text: "<b>Home CCTV Hub</b>",
      config: CONFIG,
      fetchImpl,
      log: () => undefined,
      timeoutMs: 2500,
    });

    expect(result).toEqual({ ok: true, status: "sent" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`${TELEGRAM_API_BASE}/bot${FAKE_TOKEN}/sendMessage`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
    // A bounded request: the signal is wired to a timeout.
    expect(init.signal).toBeInstanceOf(AbortSignal);

    const body = requestBody(fetchImpl.mock.calls[0]!);
    expect(body.chat_id).toBe(FAKE_CHAT_ID);
    expect(body.parse_mode).toBe("HTML");
    expect(body.disable_web_page_preview).toBe(true);
    expect(String(body.text)).toContain("Home CCTV Hub");
  });

  it("TELEGRAM-006 never invents a chat id", async () => {
    const fetchImpl = okFetch();
    await sendTelegramMessage({ text: "x", config: { ...CONFIG, telegramChatId: "42" }, fetchImpl, log: () => undefined });
    expect(requestBody(fetchImpl.mock.calls[0]!).chat_id).toBe("42");
  });

  it("truncates a message that would exceed the Telegram limit", async () => {
    const fetchImpl = okFetch();
    await sendTelegramMessage({ text: "x".repeat(5000), config: CONFIG, fetchImpl, log: () => undefined });
    const body = requestBody(fetchImpl.mock.calls[0]!);
    expect(String(body.text).length).toBeLessThanOrEqual(4096);
  });

  it("refuses an empty message without calling Telegram", async () => {
    const fetchImpl = okFetch();
    const result = await sendTelegramMessage({ text: "   ", config: CONFIG, fetchImpl, log: () => undefined });
    expect(result).toEqual({ ok: false, status: "invalid_text", detail: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("TELEGRAM-009 / 010 / 011 — Telegram failures stay contained", () => {
  it("TELEGRAM-009 returns a safe failure on HTTP 400", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { ok: false, description: "Bad Request: chat not found" }));
    const result = await sendTelegramMessage({ text: "x", config: CONFIG, fetchImpl, log: () => undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("http_error");
      expect(result.detail).toContain("HTTP 400");
      expect(result.detail).toContain("chat not found");
    }
    expect(telegramFailureMessage(result)).toContain("HTTP 400");
  });

  it("TELEGRAM-010 returns a safe failure on HTTP 500", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(500, { ok: false }));
    const result = await sendTelegramMessage({ text: "x", config: CONFIG, fetchImpl, log: () => undefined });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("http_error");
  });

  it("survives a non-JSON error body", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>gateway</html>", { status: 502 }));
    const result = await sendTelegramMessage({ text: "x", config: CONFIG, fetchImpl, log: () => undefined });
    expect(result.ok).toBe(false);
    // A non-JSON body cannot confirm ok=true, so the detail says so.
    if (!result.ok) expect(result.detail).toBe("HTTP 502: unreadable response");
  });

  it("TELEGRAM-011 returns a safe failure when the request times out", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            const error = new Error("This operation was aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    );
    const result = await sendTelegramMessage({
      text: "x",
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => undefined,
      timeoutMs: 20,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("timeout");
      expect(result.detail).toContain("20 ms");
    }
  });

  it("survives a network error", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const result = await sendTelegramMessage({
      text: "x",
      config: CONFIG,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      log: () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("network_error");
  });

  it("never throws, whatever the transport does", async () => {
    const fetchImpl = vi.fn(async () => {
      throw "a string, not an Error";
    });
    await expect(
      sendTelegramMessage({ text: "x", config: CONFIG, fetchImpl: fetchImpl as unknown as typeof fetch, log: () => undefined }),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("TELEGRAM-018 — the token never leaves the server", () => {
  it("keeps the token out of logs, results and messages", async () => {
    const log = vi.fn();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { ok: false, description: `Bad Request for bot ${FAKE_TOKEN}` }),
    );

    const result = await sendTelegramMessage({ text: "x", config: CONFIG, fetchImpl, log });

    const everything = JSON.stringify({ result, logged: log.mock.calls });
    expect(everything).not.toContain(FAKE_TOKEN);
    expect(everything).not.toContain(TELEGRAM_API_BASE);
    expect(log.mock.calls.flat().join(" ")).not.toContain(FAKE_TOKEN);
    // The description survives, with the secret replaced.
    if (!result.ok) expect(result.detail).toContain("[redacted]");
  });

  it("redacts the token out of any string", () => {
    expect(redactTelegramSecret(`url /bot${FAKE_TOKEN}/sendMessage`, FAKE_TOKEN)).toBe(
      "url /bot[redacted]/sendMessage",
    );
    expect(redactTelegramSecret("nothing to hide", FAKE_TOKEN)).toBe("nothing to hide");
    expect(redactTelegramSecret("kept", "")).toBe("kept");
  });

  it("describes failures without a secret", async () => {
    const cases = [
      { ok: false as const, status: "disabled" as const, detail: null },
      { ok: false as const, status: "not_configured" as const, detail: null },
      { ok: false as const, status: "timeout" as const, detail: "no response within 5000 ms" },
      { ok: false as const, status: "network_error" as const, detail: "request failed" },
      { ok: false as const, status: "http_error" as const, detail: "HTTP 400: chat not found" },
      { ok: true as const, status: "sent" as const },
    ];
    for (const item of cases) {
      const message = telegramFailureMessage(item);
      expect(message).not.toContain(FAKE_TOKEN);
      expect(message).not.toContain(FAKE_CHAT_ID);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});

describe("TELEGRAM-019 — a bot username is not a chat id", () => {
  it("detects the common configuration mistake", () => {
    // A bot username (the mistake), with or without the @.
    expect(looksLikeInvalidChatId("home_hik_cctv_bot")).toBe(true);
    expect(looksLikeInvalidChatId("@home_hik_cctv_bot")).toBe(true);
    expect(looksLikeInvalidChatId("my group")).toBe(true);
    // Real chat ids: positive for a private chat, negative for a group/channel.
    expect(looksLikeInvalidChatId("123456789")).toBe(false);
    expect(looksLikeInvalidChatId("-1001234567890")).toBe(false);
    // Empty is "not configured", a different failure.
    expect(looksLikeInvalidChatId("")).toBe(false);
  });

  it("refuses to call Telegram and explains the fix", async () => {
    const fetchImpl = okFetch();
    const log = vi.fn();
    const result = await sendTelegramMessage({
      text: "x",
      config: { ...CONFIG, telegramChatId: "@home_hik_cctv_bot" },
      fetchImpl,
      log,
    });

    expect(result).toEqual({ ok: false, status: "invalid_chat_id", detail: null });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith("configuration invalid");

    const message = telegramFailureMessage(result);
    expect(message).toContain("TELEGRAM_CHAT_ID is not a chat id");
    expect(message).toContain("getUpdates");
    expect(message).not.toContain(FAKE_TOKEN);
  });

  it("still sends when the chat id is numeric", async () => {
    const fetchImpl = okFetch();
    const result = await sendTelegramMessage({ text: "x", config: CONFIG, fetchImpl, log: () => undefined });
    expect(result.ok).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

/* ---------------------------------------------------------------------------
 * TELEGRAM-MEDIA — the upload senders.
 *
 * The fetch implementation is injected, so the multipart body is inspected
 * without contacting Telegram.
 * ------------------------------------------------------------------------- */

const PHOTO: TelegramFile = {
  bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x01, 0x02, 0x03]),
  filename: "face-1.jpg",
  contentType: "image/jpeg",
};
const VIDEO: TelegramFile = {
  bytes: new Uint8Array([0, 0, 0, 0x18, 0x66, 0x74, 0x79, 0x70, 1, 2, 3]),
  filename: "cctv-event.mp4",
  contentType: "video/mp4",
};

function formOf(call: unknown[]): FormData {
  return (call[1] as RequestInit).body as FormData;
}

describe("TELEGRAM-MEDIA-002 — sendPhoto", () => {
  it("uploads the image as multipart without a caption", async () => {
    const fetchImpl = okFetch();
    const result = await sendTelegramPhoto({
      photo: PHOTO,
      config: CONFIG,
      fetchImpl,
      log: () => undefined,
    });

    expect(result).toEqual({ ok: true, status: "sent" });
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe(`${TELEGRAM_API_BASE}/bot${FAKE_TOKEN}/sendPhoto`);
    expect(init.method).toBe("POST");
    // FormData sets its own multipart boundary; no explicit content type.
    expect(init.headers).toBeUndefined();

    const form = formOf(fetchImpl.mock.calls[0]!);
    expect(form.get("chat_id")).toBe(FAKE_CHAT_ID);
    // Media only: no caption, so no parse_mode is sent either.
    expect(form.get("caption")).toBeNull();
    expect(form.get("parse_mode")).toBeNull();
    const photo = form.get("photo") as Blob;
    expect(photo.size).toBe(PHOTO.bytes.length);
    expect(photo.type).toBe("image/jpeg");
  });

  it("skips an empty or oversized crop without calling Telegram", async () => {
    const fetchImpl = okFetch();
    const empty = await sendTelegramPhoto({
      photo: { ...PHOTO, bytes: new Uint8Array() },
      config: CONFIG,
      fetchImpl,
      log: () => undefined,
    });
    expect(empty).toEqual({ ok: false, status: "file_missing", detail: null });

    const big = await sendTelegramPhoto({
      photo: { ...PHOTO, bytes: new Uint8Array(11 * 1024 * 1024) },
      config: CONFIG,
      fetchImpl,
      log: () => undefined,
    });
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.status).toBe("file_too_large");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("respects the master switch", async () => {
    const fetchImpl = okFetch();
    const result = await sendTelegramPhoto({
      photo: PHOTO,
      config: { ...CONFIG, telegramNotificationsEnabled: false },
      fetchImpl,
      log: () => undefined,
    });
    expect(result).toEqual({ ok: false, status: "disabled", detail: null });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("TELEGRAM-MEDIA-011 / 019 — sendVideo and sendMediaGroup", () => {
  it("uploads the clip with sendVideo and streaming enabled", async () => {
    const fetchImpl = okFetch();
    const result = await sendTelegramVideo({
      video: VIDEO,
      config: CONFIG,
      fetchImpl,
      log: () => undefined,
    });

    expect(result.ok).toBe(true);
    const [url] = fetchImpl.mock.calls[0]! as unknown as [string];
    expect(url).toBe(`${TELEGRAM_API_BASE}/bot${FAKE_TOKEN}/sendVideo`);

    const form = formOf(fetchImpl.mock.calls[0]!);
    expect(form.get("chat_id")).toBe(FAKE_CHAT_ID);
    expect(form.get("supports_streaming")).toBe("true");
    // Media only: no caption.
    expect(form.get("caption")).toBeNull();
    expect((form.get("video") as Blob).size).toBe(VIDEO.bytes.length);
  });

  it("rejects a clip over the documented bot limit", async () => {
    const fetchImpl = okFetch();
    const result = await sendTelegramVideo({
      video: { ...VIDEO, bytes: new Uint8Array(TELEGRAM_MAX_VIDEO_BYTES + 1) },
      config: CONFIG,
      fetchImpl,
      log: () => undefined,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("file_too_large");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uploads several crops as one album with attach:// references", async () => {
    const fetchImpl = okFetch();
    const result = await sendTelegramMediaGroup({
      photos: [PHOTO, { ...PHOTO, filename: "face-2.jpg", bytes: new Uint8Array([0xff, 0xd8, 0xff, 9]) }],
      config: CONFIG,
      fetchImpl,
      log: () => undefined,
    });

    expect(result.ok).toBe(true);
    const [url] = fetchImpl.mock.calls[0]! as unknown as [string];
    expect(url).toBe(`${TELEGRAM_API_BASE}/bot${FAKE_TOKEN}/sendMediaGroup`);

    const form = formOf(fetchImpl.mock.calls[0]!);
    const media = JSON.parse(String(form.get("media"))) as Array<Record<string, string>>;
    expect(media).toHaveLength(2);
    expect(media[0]).toMatchObject({ type: "photo", media: "attach://photo0" });
    expect(media[1]).toMatchObject({ type: "photo", media: "attach://photo1" });
    expect(media[1]!.caption).toBeUndefined();
    expect((form.get("photo0") as Blob).size).toBe(PHOTO.bytes.length);
    expect((form.get("photo1") as Blob).size).toBe(4);
  });

  it("caps an album at Telegram's ten item limit", async () => {
    const fetchImpl = okFetch();
    const photos = Array.from({ length: 12 }, (_, index) => ({ ...PHOTO, filename: `face-${index}.jpg` }));
    await sendTelegramMediaGroup({ photos, config: CONFIG, fetchImpl, log: () => undefined });
    const media = JSON.parse(String(formOf(fetchImpl.mock.calls[0]!).get("media"))) as unknown[];
    expect(media).toHaveLength(10);
  });

  it("TELEGRAM-MEDIA-021 never logs the token for an upload", async () => {
    const log = vi.fn();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(400, { ok: false, description: `Bad Request for bot ${FAKE_TOKEN}` }),
    );
    const result = await sendTelegramVideo({
      video: VIDEO,
      config: CONFIG,
      fetchImpl,
      log,
    });

    expect(result.ok).toBe(false);
    expect(JSON.stringify(log.mock.calls)).not.toContain(FAKE_TOKEN);
    expect(JSON.stringify(result)).not.toContain(FAKE_TOKEN);
    if (!result.ok) expect(result.detail).toContain("[redacted]");
  });
});

/* ---------------------------------------------------------------------------
 * TELEGRAM-MEDIA-012 / 013 — the Telegram response decides success.
 *
 * Telegram answers HTTP 200 with `{"ok":false}` for several refusals, so a
 * successful HTTP round trip is not enough.
 * ------------------------------------------------------------------------- */

describe("TELEGRAM-MEDIA-012 / 013 — response validation", () => {
  it("TELEGRAM-MEDIA-012 accepts only ok:true with a result", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ok: true, result: { message_id: 42, video: { file_id: "abc" } } }),
    );
    const result = await sendTelegramVideo({
      video: VIDEO,
      config: CONFIG,
      fetchImpl,
      log: () => undefined,
    });
    expect(result).toEqual({ ok: true, status: "sent" });
  });

  it("TELEGRAM-MEDIA-013 treats HTTP 200 with ok:false as a failed upload", async () => {
    const log = vi.fn();
    const fetchImpl = vi.fn(async () =>
      jsonResponse(200, { ok: false, error_code: 400, description: "Bad Request: VIDEO_TOO_BIG" }),
    );
    const result = await sendTelegramVideo({ video: VIDEO, config: CONFIG, fetchImpl, log });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("http_error");
      expect(result.detail).toContain("VIDEO_TOO_BIG");
    }
    expect(log).toHaveBeenCalledWith("notification failed");
  });

  it("treats a 200 without a result object as a failed upload", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    const result = await sendTelegramVideo({ video: VIDEO, config: CONFIG, fetchImpl, log: () => undefined });
    expect(result.ok).toBe(false);
  });

  it("treats a 200 with an unreadable body as a failed upload", async () => {
    const fetchImpl = vi.fn(async () => new Response("<html>nope</html>", { status: 200 }));
    const result = await sendTelegramVideo({ video: VIDEO, config: CONFIG, fetchImpl, log: () => undefined });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.detail).toContain("unreadable response");
  });
});

describe("TELEGRAM-CAPTION-008 — media caption formatting", () => {
  const TIME = "2026-10-23T18:34:00+05:30";

  it("formats the person caption with camera, event time and confidence", () => {
    expect(
      buildTelegramMediaCaption({
        kind: "person",
        cameraName: "Parking",
        eventTimestamp: TIME,
        confidence: 0.87,
      }),
    ).toBe(
      [
        "🚨 <b>Person detected</b>",
        "",
        "📹 Camera: Parking",
        "🕐 Time: 23 Oct 2026, 06:34 PM",
        "🎯 Confidence: 87%",
      ].join("\n"),
    );
  });

  it("formats the vehicle and face captions", () => {
    expect(
      buildTelegramMediaCaption({ kind: "vehicle", cameraName: "Left Side Outside", eventTimestamp: TIME, confidence: 0.7 }),
    ).toContain("🚗 <b>Vehicle detected</b>");
    expect(
      buildTelegramMediaCaption({ kind: "face", cameraName: "First Floor Passage", eventTimestamp: TIME, confidence: 0.82 }),
    ).toContain("👤 <b>Face detected</b>");
  });

  it("rounds the detector confidence to whole percent", () => {
    for (const [confidence, expected] of [
      [0.87, "87%"],
      [0.734, "73%"],
      [0.999, "100%"],
      [0.5, "50%"],
    ] as const) {
      expect(
        buildTelegramMediaCaption({ kind: "person", cameraName: "Parking", eventTimestamp: TIME, confidence }),
      ).toContain(`🎯 Confidence: ${expected}`);
    }
  });

  it("omits the confidence line when the source has none", () => {
    const caption = buildTelegramMediaCaption({
      kind: "person",
      cameraName: "Parking",
      eventTimestamp: TIME,
      confidence: null,
    });
    expect(caption).not.toContain("Confidence");
    expect(caption).toContain("🚨 <b>Person detected</b>");
  });

  it("renders the event timestamp in India time, never the send time", () => {
    expect(formatTelegramTime("2026-10-23T18:34:00+05:30")).toBe("23 Oct 2026, 06:34 PM");
    expect(formatTelegramTime("2026-10-22T19:00:00Z")).toBe("23 Oct 2026, 12:30 AM");
    expect(
      buildTelegramMediaCaption({
        kind: "face",
        cameraName: "Parking",
        eventTimestamp: "2021-03-04T09:05:00+05:30",
        confidence: 0.9,
      }),
    ).toContain("🕐 Time: 04 Mar 2021, 09:05 AM");
  });

  it("escapes HTML-sensitive camera names and contains no path, id or secret", () => {
    const caption = buildTelegramMediaCaption({
      kind: "person",
      cameraName: "Front <b>Gate</b> & Co",
      eventTimestamp: TIME,
      confidence: 0.8,
    });
    expect(caption).toContain("📹 Camera: Front &lt;b&gt;Gate&lt;/b&gt; &amp; Co");
    expect(caption).not.toContain(FAKE_TOKEN);
    expect(caption).not.toContain(FAKE_CHAT_ID);
    expect(caption).not.toMatch(/\/data\//);
    expect(caption).not.toContain(".jpg");
    expect(caption).not.toContain("rtsp://");
    expect(caption).not.toContain("evt_");
  });

  it("sends the caption in Telegram's caption field for photos", async () => {
    const fetchImpl = okFetch();
    const caption = buildTelegramMediaCaption({
      kind: "person",
      cameraName: "Parking",
      eventTimestamp: TIME,
      confidence: 0.87,
    });
    await sendTelegramPhoto({ photo: PHOTO, caption, config: CONFIG, fetchImpl, log: () => undefined });
    const form = formOf(fetchImpl.mock.calls[0]!);
    expect(form.get("caption")).toBe(caption);
    expect(form.get("parse_mode")).toBe("HTML");
  });

  it("sends the caption in Telegram's caption field for videos", async () => {
    const fetchImpl = okFetch();
    const caption = buildTelegramMediaCaption({
      kind: "vehicle",
      cameraName: "Parking",
      eventTimestamp: TIME,
      confidence: 0.7,
    });
    await sendTelegramVideo({ video: VIDEO, caption, config: CONFIG, fetchImpl, log: () => undefined });
    const form = formOf(fetchImpl.mock.calls[0]!);
    expect(form.get("caption")).toBe(caption);
    expect(form.get("parse_mode")).toBe("HTML");
  });

  it("keeps escaping reversible for plain text", () => {
    expect(escapeTelegramHtml("a & b < c > d")).toBe("a &amp; b &lt; c &gt; d");
  });
});
