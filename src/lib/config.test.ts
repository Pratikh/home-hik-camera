import { describe, expect, it } from "vitest";
import { DEFAULT_FACE_CONFIDENCE, DEFAULT_FACE_MAX_FACES, readConfig } from "@/lib/config";

const secret = "session-secret-value";

describe("readConfig", () => {
  it("requires application credentials and a session secret", () => {
    const config = readConfig({});
    expect(config.appConfigured).toBe(false);
    expect(config.appErrors).toEqual([
      "APP_USERNAME is required",
      "APP_PASSWORD is required",
      "SESSION_SECRET is required",
    ]);
    expect(config.dvrConfigured).toBe(false);
  });

  it("rejects a short session secret", () => {
    const config = readConfig({
      APP_USERNAME: "home",
      APP_PASSWORD: "correct-horse",
      SESSION_SECRET: "short",
    });
    expect(config.appErrors).toContain("SESSION_SECRET must be at least 16 characters");
  });

  it("accepts legacy DVR variable names without inventing a password", () => {
    const config = readConfig({
      APP_USERNAME: "home",
      APP_PASSWORD: "correct-horse",
      SESSION_SECRET: secret,
      HIKVISION_IP: "10.1.1.20",
      HIKVISION_USERNAME: "admin",
      HIKVISION_PASSWORD: "from-env",
    });
    expect(config.appConfigured).toBe(true);
    expect(config.dvrConfigured).toBe(true);
    expect(config.dvrHost).toBe("10.1.1.20");
    expect(config.dvrUsername).toBe("admin");
    expect(config.dvrPassword).toBe("from-env");
    expect(config.dvrHttpPort).toBe(80);
    expect(config.dvrRtspPort).toBe(554);
    expect(config.cookieSecure).toBe(false);
    expect(config.videoDevPlaceholder).toBe(false);
  });

  it("leaves the DVR unconfigured when the host is empty", () => {
    const config = readConfig({
      APP_USERNAME: "home",
      APP_PASSWORD: "correct-horse",
      SESSION_SECRET: secret,
      DVR_HOST: "  ",
    });
    expect(config.dvrConfigured).toBe(false);
    expect(config.dvrHost).toBe("");
  });

  it("flags an invalid DVR port", () => {
    const config = readConfig({
      APP_USERNAME: "home",
      APP_PASSWORD: "correct-horse",
      SESSION_SECRET: secret,
      DVR_HOST: "10.0.0.8",
      DVR_USERNAME: "admin",
      DVR_PASSWORD: "secret",
      DVR_HTTP_PORT: "abc",
    });
    expect(config.dvrConfigured).toBe(false);
    expect(config.dvrErrors[0]).toContain("DVR_HTTP_PORT");
  });
});

/**
 * FACE-001 — face detection is opt-in.
 *
 * A missing or malformed face setting must leave the rest of the application
 * untouched, so these values never appear in `appErrors`.
 */
describe("readConfig — face detection", () => {
  it("FACE-001 is disabled by default with the documented defaults", () => {
    const config = readConfig({});
    expect(config.faceDetectionEnabled).toBe(false);
    expect(config.faceDetectionConfidence).toBe(DEFAULT_FACE_CONFIDENCE);
    expect(config.faceDetectionConfidence).toBe(0.6);
    expect(config.faceDetectionMaxFaces).toBe(DEFAULT_FACE_MAX_FACES);
    expect(config.faceDetectionMaxFaces).toBe(10);
  });

  it("FACE-001 only enables for the exact string true", () => {
    expect(readConfig({ FACE_DETECTION_ENABLED: "true" }).faceDetectionEnabled).toBe(true);
    // Surrounding whitespace and case do not matter, matching every other flag.
    expect(readConfig({ FACE_DETECTION_ENABLED: " TRUE " }).faceDetectionEnabled).toBe(true);
    for (const value of ["false", "1", "yes", "", "true!"]) {
      expect(readConfig({ FACE_DETECTION_ENABLED: value }).faceDetectionEnabled).toBe(false);
    }
  });

  it("reads the threshold and the cap, and falls back when they are nonsense", () => {
    const configured = readConfig({ FACE_DETECTION_CONFIDENCE: "0.75", FACE_DETECTION_MAX_FACES: "4" });
    expect(configured.faceDetectionConfidence).toBe(0.75);
    expect(configured.faceDetectionMaxFaces).toBe(4);

    expect(readConfig({ FACE_DETECTION_CONFIDENCE: "2" }).faceDetectionConfidence).toBe(DEFAULT_FACE_CONFIDENCE);
    expect(readConfig({ FACE_DETECTION_CONFIDENCE: "abc" }).faceDetectionConfidence).toBe(DEFAULT_FACE_CONFIDENCE);
    expect(readConfig({ FACE_DETECTION_MAX_FACES: "0" }).faceDetectionMaxFaces).toBe(DEFAULT_FACE_MAX_FACES);
    expect(readConfig({ FACE_DETECTION_MAX_FACES: "lots" }).faceDetectionMaxFaces).toBe(DEFAULT_FACE_MAX_FACES);
  });

  it("never reports a bad face setting as an application configuration error", () => {
    const config = readConfig({
      APP_USERNAME: "home",
      APP_PASSWORD: "correct-horse",
      SESSION_SECRET: secret,
      FACE_DETECTION_CONFIDENCE: "not-a-number",
      FACE_DETECTION_MAX_FACES: "-1",
    });
    expect(config.appErrors).toEqual([]);
    expect(config.appConfigured).toBe(true);
  });
});

describe("telegram media flags", () => {
  const base = {
    APP_USERNAME: "home",
    APP_PASSWORD: "app-password",
    SESSION_SECRET: "0123456789abcdef0123456789abcdef",
    TELEGRAM_NOTIFICATIONS_ENABLED: "true",
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_CHAT_ID: "-1001",
    TELEGRAM_FACE_NOTIFICATIONS: "true",
  };

  it("defaults the snapshot and clip attachments to on", () => {
    const config = readConfig(base);
    expect(config.telegramFaceImage).toBe(true);
    expect(config.telegramFaceVideo).toBe(true);
    expect(config.telegramVideoPreSeconds).toBe(5);
    expect(config.telegramVideoPostSeconds).toBe(5);
    expect(config.telegramVideoMaxMb).toBe(45);
    expect(config.telegramVideoTimeoutSeconds).toBe(30);
    expect(config.ffmpegPath).toBe("ffmpeg");
  });

  it("accepts the renamed TELEGRAM_EVENT_IMAGE and still honours the old name", () => {
    // The accurate name wins when both are present.
    expect(readConfig({ ...base, TELEGRAM_EVENT_IMAGE: "true", TELEGRAM_FACE_IMAGE: "false" }).telegramFaceImage).toBe(true);
    expect(readConfig({ ...base, TELEGRAM_EVENT_IMAGE: "false" }).telegramFaceImage).toBe(false);
    // The legacy name keeps working on its own…
    expect(readConfig({ ...base, TELEGRAM_FACE_IMAGE: "false" }).telegramFaceImage).toBe(false);
    // …and an empty new value falls through instead of counting as "set".
    expect(readConfig({ ...base, TELEGRAM_EVENT_IMAGE: "", TELEGRAM_FACE_IMAGE: "false" }).telegramFaceImage).toBe(false);
  });

  it("bounds the clip size and timeout", () => {
    expect(readConfig({ ...base, TELEGRAM_VIDEO_MAX_MB: "49" }).telegramVideoMaxMb).toBe(49);
    // Above Telegram's own 50 MB bot limit is refused, falling back to the default.
    expect(readConfig({ ...base, TELEGRAM_VIDEO_MAX_MB: "500" }).telegramVideoMaxMb).toBe(45);
    expect(readConfig({ ...base, TELEGRAM_VIDEO_TIMEOUT_SECONDS: "120" }).telegramVideoTimeoutSeconds).toBe(120);
    expect(readConfig({ ...base, TELEGRAM_VIDEO_TIMEOUT_SECONDS: "1" }).telegramVideoTimeoutSeconds).toBe(30);
  });
});
