import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cameraChannels } from "@/server/cameras/channels";
import { cameraStreamPlan, renderMediamtxConfig } from "../../../scripts/render-mediamtx-config.mjs";

describe("MediaMTX config", () => {
  it("matches the camera channel map and keeps credentials out of the template", () => {
    expect(cameraStreamPlan()).toEqual(cameraChannels());
    const template = readFileSync("mediamtx/mediamtx.yml", "utf8");
    expect(template).not.toContain("rtsp://");
    expect(template).not.toContain("DVR_PASSWORD");
  });

  it("encodes credentials into the runtime source and omits them when the DVR is unset", () => {
    const password = "p@ss/word";
    const yaml = renderMediamtxConfig({
      DVR_HOST: "10.0.0.8",
      DVR_RTSP_PORT: "554",
      DVR_USERNAME: "admin",
      DVR_PASSWORD: password,
      WEBRTC_ADDITIONAL_HOST: "192.168.1.40",
    });
    expect(yaml).toContain("Streaming/Channels/102");
    expect(yaml).toContain("Streaming/Channels/401");
    expect(yaml).toContain(encodeURIComponent(password));
    expect(yaml).not.toContain(password);
    expect(yaml).toContain("192.168.1.40");
    expect(yaml).toContain("127.0.0.1");
    const empty = renderMediamtxConfig({});
    expect(empty).not.toContain("rtsp://");
  });
});
