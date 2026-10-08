import { describe, expect, it } from "vitest";
import { Messages } from "@/lib/messages";
import { hostName, selectPlaybackMode } from "@/lib/playback";

const ready = {
  placeholder: false,
  dvr: "connected" as const,
  gateway: "connected" as const,
  cameraOnline: true,
  requestHost: "127.0.0.1:3000",
  webrtcAdditionalHosts: [] as string[],
};

describe("playback mode", () => {
  it("keeps the placeholder explicit", () => {
    expect(selectPlaybackMode({ ...ready, placeholder: true }).message).toBe(Messages.placeholder);
  });

  it("reports configuration, offline, auth, gateway, and camera states", () => {
    expect(selectPlaybackMode({ ...ready, dvr: "not_configured" }).message).toBe(Messages.dvrNotConfigured);
    expect(selectPlaybackMode({ ...ready, dvr: "disconnected" }).message).toBe(Messages.dvrOffline);
    expect(selectPlaybackMode({ ...ready, dvr: "auth_failed" }).message).toBe(Messages.dvrAuthFailed);
    expect(selectPlaybackMode({ ...ready, gateway: "disconnected" }).message).toBe(Messages.gatewayDown);
    expect(selectPlaybackMode({ ...ready, cameraOnline: false }).message).toBe(Messages.cameraUnavailable);
  });

  it("uses WebRTC on localhost and HLS for a LAN phone until an extra host is set", () => {
    expect(selectPlaybackMode(ready).mode).toBe("webrtc");
    expect(hostName("[::1]:3000")).toBe("::1");
    const phone = selectPlaybackMode({ ...ready, requestHost: "192.168.1.40:3000" });
    expect(phone).toEqual({ mode: "hls", message: Messages.liveHls });
    const advertised = selectPlaybackMode({
      ...ready,
      requestHost: "192.168.1.40:3000",
      webrtcAdditionalHosts: ["192.168.1.40"],
    });
    expect(advertised.mode).toBe("webrtc");
  });
});
