import { describe, expect, it } from "vitest";
import { cameraChannels, describePlaybackPath, describeStreamPath, isRelayPath, normalizeCameraName } from "@/server/cameras/channels";

describe("camera channels", () => {
  it("maps four cameras to Hikvision main and sub channel ids", () => {
    const cameras = cameraChannels();
    expect(cameras.map((camera) => camera.mainChannel)).toEqual([101, 201, 301, 401]);
    expect(cameras.map((camera) => camera.subChannel)).toEqual([102, 202, 302, 402]);
    expect(cameras.map((camera) => camera.subPath)).toEqual(["cam1_sub", "cam2_sub", "cam3_sub", "cam4_sub"]);
    expect(describeStreamPath("cam4_main")).toEqual({ cameraId: 4, channel: 401, kind: "main" });
    expect(describeStreamPath("cam9_sub")).toBeNull();
    expect(describePlaybackPath("playback")).toEqual({ cameraId: 0, track: 0 });
    expect(describePlaybackPath("pb1")).toEqual({ cameraId: 1, track: 101 });
    expect(describePlaybackPath("pb4")).toEqual({ cameraId: 4, track: 401 });
    expect(describePlaybackPath("cam1_main")).toBeNull();
    expect(isRelayPath("pb2")).toBe(true);
    expect(isRelayPath("cam3_sub")).toBe(true);
    expect(isRelayPath("../etc")).toBe(false);
  });

  it("accepts display names and rejects blank ones", () => {
    expect(normalizeCameraName("  Front door ")).toBe("Front door");
    expect(normalizeCameraName("   ")).toBeNull();
    expect(normalizeCameraName("a".repeat(40))).toBeNull();
  });
});
