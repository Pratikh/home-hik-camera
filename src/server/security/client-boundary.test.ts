import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readConfig } from "@/lib/config";
import { maskSettings } from "@/server/settings";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "api") return [];
      return walk(full);
    }
    return full.endsWith(".ts") || full.endsWith(".tsx") ? [full] : [];
  });
}

describe("client boundary", () => {
  it("keeps DVR secrets and RTSP URLs out of browser source", () => {
    const files = [...walk("src/components"), ...walk("src/app")];
    const forbidden = ["DVR_PASSWORD", "HIKVISION_PASSWORD", "APP_PASSWORD", "SESSION_SECRET", "rtsp://", "NEXT_PUBLIC_"];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const pattern of forbidden) {
        expect(text, file).not.toContain(pattern);
      }
    }
  });

  it("masks the DVR password in settings", () => {
    const config = readConfig({
      APP_USERNAME: "home",
      APP_PASSWORD: "app-secret-value",
      SESSION_SECRET: "session-secret-value",
      DVR_HOST: "10.0.0.8",
      DVR_USERNAME: "admin",
      DVR_PASSWORD: "dvr-secret-value",
    });
    const masked = maskSettings(config);
    const encoded = JSON.stringify(masked);
    expect(masked.dvrPasswordMask).toBe("********");
    expect(encoded).not.toContain("dvr-secret-value");
    expect(encoded).not.toContain("app-secret-value");
  });
});
