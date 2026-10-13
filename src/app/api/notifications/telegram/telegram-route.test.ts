import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * POST /api/notifications/telegram/test — TELEGRAM-016 and TELEGRAM-017.
 *
 * The route is exercised through the real Telegram module: only `fetch` is
 * stubbed, so the request it would make is observable without contacting
 * Telegram. The config is mocked so no real credential is involved.
 */

const FAKE_TOKEN = "222222:BBBfake-route-token-value";
const FAKE_CHAT_ID = "-1009876543210";

const CONFIG = {
  telegramNotificationsEnabled: true,
  telegramBotToken: FAKE_TOKEN,
  telegramChatId: FAKE_CHAT_ID,
  telegramFaceNotifications: true,
};

const currentUser = vi.fn();

vi.mock("@/lib/config", () => ({ getConfig: () => CONFIG }));

vi.mock("@/server/http/require-user", () => ({
  requireAdmin: async () => {
    const user = currentUser() as { username: string; role: string; userId: string; sessionId: string } | null;
    if (!user) {
      return { ok: false as const, response: NextResponse.json({ error: "Authentication failed" }, { status: 401 }) };
    }
    if (user.role !== "ADMIN") {
      return { ok: false as const, response: NextResponse.json({ error: "Authentication failed" }, { status: 403 }) };
    }
    return { ok: true as const, ...user };
  },
}));

const statusMock = vi.fn();

vi.mock("@/server/notifications/telegram-media", () => ({
  telegramMediaStatus: () => statusMock(),
}));

const { POST } = await import("@/app/api/notifications/telegram/test/route");
const { GET } = await import("@/app/api/notifications/telegram/status/route");

function telegramFetch(status = 200, body: unknown = { ok: true, result: { message_id: 1 } }) {
  return vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
}

const ADMIN = { username: "home", role: "ADMIN", userId: "u1", sessionId: "s1" };

beforeEach(() => {
  currentUser.mockReset();
  currentUser.mockReturnValue(ADMIN);
  CONFIG.telegramNotificationsEnabled = true;
  CONFIG.telegramBotToken = FAKE_TOKEN;
  CONFIG.telegramChatId = FAKE_CHAT_ID;
  CONFIG.telegramFaceNotifications = true;
  statusMock.mockReset();
  statusMock.mockResolvedValue({
    enabled: true,
    configured: true,
    faceNotifications: true,
    faceImage: true,
    faceVideo: true,
    videoPreSeconds: 5,
    videoPostSeconds: 5,
    clipSeconds: 10,
    ffmpeg: "available",
    queueDepth: 0,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TELEGRAM-017 an ADMIN can send the test message", () => {
  it("sends the test text and reports success without any secret", async () => {
    const fetchImpl = telegramFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST();
    expect(response.status).toBe(200);

    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ ok: true, message: "Telegram test message sent." });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toContain("/sendMessage");
    const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(payload.chat_id).toBe(FAKE_CHAT_ID);
    expect(payload.parse_mode).toBe("HTML");
    expect(String(payload.text)).toContain("Home CCTV Hub");
    expect(String(payload.text)).toContain("Telegram notification test successful.");

    // The response body carries no credential and no API URL.
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(FAKE_TOKEN);
    expect(serialised).not.toContain(FAKE_CHAT_ID);
    expect(serialised).not.toContain("api.telegram.org");
  });

  it("works even when face notifications are off (it is a general test)", async () => {
    CONFIG.telegramFaceNotifications = false;
    const fetchImpl = telegramFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST();
    expect(response.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("TELEGRAM-016 only an ADMIN may call it", () => {
  it("refuses a VIEWER with 403 and sends nothing", async () => {
    currentUser.mockReturnValue({ ...ADMIN, role: "VIEWER" });
    const fetchImpl = telegramFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST();
    expect(response.status).toBe(403);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(FAKE_TOKEN);
  });

  it("refuses an unauthenticated caller with 401 and sends nothing", async () => {
    currentUser.mockReturnValue(null);
    const fetchImpl = telegramFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST();
    expect(response.status).toBe(401);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("configuration and failure handling", () => {
  it("reports 409 when Telegram is disabled, without calling it", async () => {
    CONFIG.telegramNotificationsEnabled = false;
    const fetchImpl = telegramFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST();
    expect(response.status).toBe(409);
    expect(fetchImpl).not.toHaveBeenCalled();
    const body = (await response.json()) as { ok: boolean; reason: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("disabled");
  });

  it("reports 503 when credentials are missing, without calling it", async () => {
    CONFIG.telegramBotToken = "";
    const fetchImpl = telegramFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST();
    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
    const body = (await response.json()) as { reason: string; error: string };
    expect(body.reason).toBe("not_configured");
    // The sentence names the variables but never their values.
    expect(body.error).toContain("TELEGRAM_BOT_TOKEN");
    expect(body.error).not.toContain(FAKE_CHAT_ID);
  });

  it("reports 503 with the fix when the chat id is a bot username", async () => {
    CONFIG.telegramChatId = "@home_hik_cctv_bot";
    const fetchImpl = telegramFetch();
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST();
    expect(response.status).toBe(503);
    expect(fetchImpl).not.toHaveBeenCalled();
    const body = (await response.json()) as { reason: string; error: string };
    expect(body.reason).toBe("invalid_chat_id");
    expect(body.error).toContain("not a chat id");
    expect(body.error).not.toContain(FAKE_TOKEN);
  });

  it("reports 502 and a safe message when Telegram rejects the message", async () => {
    const fetchImpl = telegramFetch(400, { ok: false, description: "Bad Request: chat not found" });
    vi.stubGlobal("fetch", fetchImpl);

    const response = await POST();
    expect(response.status).toBe(502);
    const body = (await response.json()) as { ok: boolean; reason: string; error: string };
    expect(body.ok).toBe(false);
    expect(body.reason).toBe("http_error");
    expect(body.error).toContain("chat not found");
    expect(JSON.stringify(body)).not.toContain(FAKE_TOKEN);
  });

  it("reports 502 on a network failure without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const response = await POST();
    expect(response.status).toBe(502);
    expect(((await response.json()) as { reason: string }).reason).toBe("network_error");
  });
});

describe("GET /api/notifications/telegram/status", () => {
  it("reports the media settings to an ADMIN without any secret", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      enabled: true,
      configured: true,
      faceImage: true,
      faceVideo: true,
      clipSeconds: 10,
      ffmpeg: "available",
    });
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain(FAKE_TOKEN);
    expect(serialised).not.toContain(FAKE_CHAT_ID);
    expect(serialised).not.toContain("api.telegram.org");
    expect(serialised).not.toContain("rtsp");
  });

  it("refuses a VIEWER and an anonymous caller", async () => {
    currentUser.mockReturnValue({ ...ADMIN, role: "VIEWER" });
    expect((await GET()).status).toBe(403);
    currentUser.mockReturnValue(null);
    expect((await GET()).status).toBe(401);
    expect(statusMock).not.toHaveBeenCalled();
  });
});
