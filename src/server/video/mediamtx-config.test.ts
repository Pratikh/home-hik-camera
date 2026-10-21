import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cameraChannels } from "@/server/cameras/channels";
import { cameraStreamPlan, mediamtxAuth, renderMediamtxConfig } from "../../../scripts/render-mediamtx-config.mjs";

const AUTH = "mediamtx-read-credential-0123456789";

describe("MediaMTX config", () => {
  it("matches the camera channel map and keeps credentials out of the template", () => {
    expect(cameraStreamPlan()).toEqual(cameraChannels());
    const template = readFileSync("mediamtx/mediamtx.yml", "utf8");
    expect(template).not.toContain("rtsp://");
    expect(template).not.toContain("DVR_PASSWORD");
    expect(template).not.toContain("MEDIAMTX_AUTH_PASSWORD");
  });

  it("encodes credentials into the runtime source and omits them when the DVR is unset", () => {
    const dvrPassword = "p@ss/word";
    const yaml = renderMediamtxConfig({
      DVR_HOST: "10.0.0.8",
      DVR_RTSP_PORT: "554",
      DVR_USERNAME: "admin",
      DVR_PASSWORD: dvrPassword,
      MEDIAMTX_AUTH_PASSWORD: AUTH,
      WEBRTC_ADDITIONAL_HOST: "192.168.1.40",
    });
    expect(yaml).toContain("Streaming/Channels/102");
    expect(yaml).toContain("Streaming/Channels/401");
    expect(yaml).toContain(encodeURIComponent(dvrPassword));
    expect(yaml).not.toContain(dvrPassword);
    expect(yaml).toContain("192.168.1.40");
    expect(yaml).toContain("127.0.0.1");
    const empty = renderMediamtxConfig({ MEDIAMTX_AUTH_PASSWORD: AUTH });
    expect(empty).not.toContain("rtsp://");
  });

  it("requires a MediaMTX read credential unless anonymous mode is explicit", () => {
    expect(() => renderMediamtxConfig({})).toThrow(/MEDIAMTX_AUTH_PASSWORD is required/);
    expect(() => renderMediamtxConfig({ MEDIAMTX_AUTH_PASSWORD: "short" })).toThrow(/at least 16/);
    expect(mediamtxAuth({ MEDIAMTX_AUTH_PASSWORD: AUTH })).toEqual({
      user: "hub",
      password: AUTH,
      allowAnonymous: false,
    });
    expect(mediamtxAuth({ MEDIAMTX_ALLOW_ANONYMOUS: "true" })).toEqual({
      user: "hub",
      password: "",
      allowAnonymous: true,
    });
  });

  it("renders an authenticated reader and keeps the API user internal", () => {
    const yaml = renderMediamtxConfig({ MEDIAMTX_AUTH_PASSWORD: AUTH, MEDIAMTX_AUTH_USER: "hub-reader" });
    expect(yaml).toContain("authMethod: internal");
    expect(yaml).toContain("  - user: hub-reader");
    expect(yaml).toContain(`    pass: "${AUTH}"`);
    expect(yaml).toContain("      - action: read");
    expect(yaml).toContain("      - action: api");
    // No anonymous read user is rendered in the production path.
    expect(yaml).not.toContain("# DEVELOPMENT ONLY");
  });

  it("allows the explicit development-only anonymous mode", () => {
    const yaml = renderMediamtxConfig({ MEDIAMTX_ALLOW_ANONYMOUS: "true" });
    expect(yaml).toContain("# DEVELOPMENT ONLY");
    expect(yaml).toContain("  - user: any");
    expect(yaml).toContain("      - action: read");
  });

  it("rejects an unsafe authentication user name", () => {
    expect(() => mediamtxAuth({ MEDIAMTX_AUTH_PASSWORD: AUTH, MEDIAMTX_AUTH_USER: "bad user" })).toThrow(
      /MEDIAMTX_AUTH_USER/,
    );
  });
});
