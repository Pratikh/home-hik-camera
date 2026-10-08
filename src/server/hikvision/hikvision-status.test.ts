import { describe, expect, it } from "vitest";
import { Messages } from "@/lib/messages";
import { readDvrOverview, type HikvisionApi } from "@/server/hikvision/hikvision-status";
import { HikvisionError } from "@/server/hikvision/hikvision-types";

function client(overrides: Partial<HikvisionApi> = {}): HikvisionApi {
  return {
    async getDeviceInfo() {
      return {
        name: "Home",
        model: "DS-7104HGHI-K1",
        serialNumber: "ABC",
        firmware: "V4.83.401 build 241110",
        encodingVersion: "V5.0 build 241106",
        hardwareVersion: "0xe9700",
        webVersion: null,
        pluginVersion: null,
        channelCount: null,
        deviceType: "DVR",
      };
    },
    async getDeviceStatus() {
      return { currentDeviceTime: "2026-10-07T12:00:00", deviceUpTime: "10" };
    },
    async getChannelStatus() {
      return [
        { id: 1, name: "Door", online: true, enabled: true },
        { id: 2, name: "Yard", online: false, enabled: true },
      ];
    },
    async getStorage() {
      return { hddCount: 1 };
    },
    ...overrides,
  };
}

describe("DVR overview", () => {
  it("assembles reported device fields", async () => {
    const overview = await readDvrOverview(client());
    expect(overview.state).toBe("connected");
    expect(overview.device).toMatchObject({
      model: "DS-7104HGHI-K1",
      firmware: "V4.83.401 build 241110",
      channelCount: 2,
      hddCount: 1,
      webVersion: null,
    });
  });

  it("maps authentication and offline failures to safe messages", async () => {
    const auth = await readDvrOverview(
      client({
        async getDeviceInfo() {
          throw new HikvisionError("auth_failed", "DVR authentication failed", 401);
        },
      }),
    );
    expect(auth).toMatchObject({ state: "auth_failed", message: Messages.dvrAuthFailed, device: null });
    const offline = await readDvrOverview(
      client({
        async getDeviceInfo() {
          throw new HikvisionError("offline", "DVR offline");
        },
      }),
    );
    expect(offline.message).toBe(Messages.dvrOffline);
  });
});
