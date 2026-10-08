import { describe, expect, it } from "vitest";
import { readConfig } from "@/lib/config";

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
