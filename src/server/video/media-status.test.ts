import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getMediaStatus,
  resetMediaStatusCache,
  sourceHost,
  type MediaStatusDeps,
} from "@/server/video/media-status";

/**
 * Per-camera media status and the DVR-address drift guard.
 *
 * MediaMTX is mocked, so no gateway is needed. The configured sources carry DVR
 * credentials, and these tests assert that nothing sensitive is ever returned or
 * logged.
 */

const DVR_HOST = "192.168.1.200";
const FAKE_SOURCE = `rtsp://admin:dvr-secret@${DVR_HOST}:554/Streaming/Channels/102`;

function mediaResponse(): Record<string, unknown> {
  return {
    items: [
      { name: "cam1_sub", ready: true, tracks: ["H264", "G711"], bytesReceived: 64108 },
      { name: "cam1_main", ready: false, tracks: [], bytesReceived: 0 },
      { name: "all_others", ready: false, tracks: [], bytesReceived: 0 },
    ],
  };
}

function configResponse(host = DVR_HOST): Record<string, unknown> {
  return {
    items: [
      { name: "all_others", source: "publisher" },
      { name: "cam1_sub", source: `rtsp://admin:dvr-secret@${host}:554/Streaming/Channels/102` },
      { name: "cam1_main", source: `rtsp://admin:dvr-secret@${host}:554/Streaming/Channels/101` },
    ],
  };
}

function deps(overrides: Partial<MediaStatusDeps> & { active?: unknown; configured?: unknown } = {}): MediaStatusDeps {
  const { active = mediaResponse(), configured = configResponse(), ...rest } = overrides;
  return {
    apiUrl: "http://127.0.0.1:9997",
    dvrHost: DVR_HOST,
    log: () => undefined,
    fetchImpl: (async (input: RequestInfo | URL) => {
      const url = String(input);
      const body = url.includes("/v3/paths/list") ? active : configured;
      if (body === null) return new Response("nope", { status: 503 });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch,
    ...rest,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  resetMediaStatusCache();
});

describe("media status", () => {
  it("reports each camera path's real state", async () => {
    const status = await getMediaStatus(deps());
    expect(status.reachable).toBe(true);
    expect(status.drift).toBe(false);
    const sub = status.paths.find((path) => path.path === "cam1_sub");
    expect(sub).toMatchObject({ cameraId: 1, kind: "sub", ready: true, bytesReceived: 64108 });
    expect(sub!.tracks).toEqual(["H264", "G711"]);
    // Non-camera paths are ignored.
    expect(status.paths.map((path) => path.path)).toEqual(["cam1_main", "cam1_sub"]);
  });

  it("flags drift when the gateway pulls from a different DVR address", async () => {
    const warnings: string[] = [];
    const status = await getMediaStatus(
      deps({ configured: configResponse("192.168.0.210"), log: (line) => warnings.push(line) }),
    );
    expect(status.drift).toBe(true);
    expect(status.message).toContain("different DVR address");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("mediamtx:up");
    // The warning names the fix, never an address or a credential.
    expect(warnings[0]).not.toContain("192.168");
    expect(warnings[0]).not.toContain("dvr-secret");
  });

  it("warns only once for the same drift", async () => {
    const warnings: string[] = [];
    const log = (line: string) => warnings.push(line);
    await getMediaStatus(deps({ configured: configResponse("10.0.0.9"), log }));
    await getMediaStatus(deps({ configured: configResponse("10.0.0.9"), log }));
    expect(warnings).toHaveLength(1);
  });

  it("reports the gateway as unreachable instead of throwing", async () => {
    const status = await getMediaStatus(
      deps({
        fetchImpl: (async () => {
          throw new TypeError("fetch failed");
        }) as typeof fetch,
      }),
    );
    expect(status).toEqual({ reachable: false, paths: [], drift: false, message: "Video gateway unavailable" });
  });

  it("survives a non-JSON gateway response", async () => {
    const status = await getMediaStatus(
      deps({
        fetchImpl: (async () => new Response("<html>no</html>", { status: 200 })) as typeof fetch,
      }),
    );
    expect(status.reachable).toBe(false);
  });

  it("never returns a source URL or a credential", async () => {
    const status = await getMediaStatus(deps());
    const serialised = JSON.stringify(status);
    expect(serialised).not.toContain("rtsp://");
    expect(serialised).not.toContain("dvr-secret");
    expect(serialised).not.toContain(DVR_HOST);
    expect(serialised).not.toContain("554");
  });
});

describe("sourceHost", () => {
  it("reads the hostname and nothing else", () => {
    expect(sourceHost(FAKE_SOURCE)).toBe(DVR_HOST);
    expect(sourceHost("rtsp://user:pw@DVR.local:554/Streaming/Channels/101")).toBe("dvr.local");
    expect(sourceHost("publisher")).toBeNull();
    expect(sourceHost("")).toBeNull();
    expect(sourceHost(null)).toBeNull();
  });
});
