import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * The HLS proxy route: authentication, path validation, upstream error mapping,
 * playlist rewriting and segment passthrough.
 *
 * MediaMTX is mocked, so no gateway is needed. These tests lock in the contract
 * a remote browser depends on: every URL the browser receives is same-origin.
 */

const currentUser = vi.fn();
const config = {
  mediamtxHlsUrl: "http://mediamtx:8888",
  mediamtxAuthUser: "",
  mediamtxAuthPassword: "",
};

vi.mock("@/server/http/require-user", () => ({
  requireUser: async () => {
    const user = currentUser();
    if (!user) {
      return { ok: false as const, response: NextResponse.json({ error: "Authentication failed" }, { status: 401 }) };
    }
    return { ok: true as const, ...user };
  },
}));

vi.mock("@/lib/config", () => ({ getConfig: () => config }));

const { GET } = await import("@/app/api/hls/[path]/[[...asset]]/route");

const ADMIN = { username: "home", role: "ADMIN", userId: "u1", sessionId: "s1" };

function call(path: string, asset?: string[], url = `http://localhost:3000/api/hls/${path}`) {
  return GET(new Request(url), { params: Promise.resolve({ path, asset }) });
}

function upstream(body: string | Uint8Array, init: ResponseInit & { type?: string } = {}) {
  return new Response(body as BodyInit, { status: 200, headers: { "content-type": "application/vnd.apple.mpegurl" }, ...init });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  currentUser.mockReset();
  currentUser.mockReturnValue(ADMIN);
  config.mediamtxAuthUser = "";
  config.mediamtxAuthPassword = "";
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("HLS proxy — access control", () => {
  it("refuses an anonymous caller before touching the gateway", async () => {
    currentUser.mockReturnValue(null);
    const response = await call("cam1_sub");
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s a path that is not a relay path", async () => {
    const response = await call("not-a-camera");
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s a traversal attempt instead of forwarding it", async () => {
    for (const asset of [[".."], ["..", "etc", "passwd"], ["a\\b"]]) {
      const response = await call("cam1_sub", asset);
      expect(response.status, JSON.stringify(asset)).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("HLS proxy — upstream contract", () => {
  it("defaults to index.m3u8 when no asset is given", async () => {
    fetchMock.mockResolvedValue(upstream("#EXTM3U\n#EXT-X-VERSION:3\n"));
    await call("cam1_sub");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://mediamtx:8888/cam1_sub/index.m3u8");
  });

  it("keeps the query string (HLS sessions live there)", async () => {
    fetchMock.mockResolvedValue(upstream("#EXTM3U\n"));
    await call("cam1_sub", ["main_stream.m3u8"], "http://localhost:3000/api/hls/cam1_sub/main_stream.m3u8?session=abc123");
    expect(fetchMock.mock.calls[0]![0]).toBe("http://mediamtx:8888/cam1_sub/main_stream.m3u8?session=abc123");
  });

  it("forwards the Range header and adds gateway auth only when configured", async () => {
    fetchMock.mockResolvedValue(upstream(new Uint8Array([0x47, 0x40])));
    await call("cam1_sub", ["seg1.ts"]);
    const plain = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers;
    expect(plain.get("authorization")).toBeNull();

    fetchMock.mockClear();
    config.mediamtxAuthUser = "gateway";
    config.mediamtxAuthPassword = "secret";
    const request = new Request("http://localhost:3000/api/hls/cam1_sub/seg1.ts", { headers: { range: "bytes=0-1023" } });
    await GET(request, { params: Promise.resolve({ path: "cam1_sub", asset: ["seg1.ts"] }) });
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers;
    expect(headers.get("range")).toBe("bytes=0-1023");
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("gateway:secret").toString("base64")}`);
  });

  it("rewrites a playlist to same-origin URLs and never leaks the upstream host", async () => {
    fetchMock.mockResolvedValue(
      upstream(
        [
          "#EXTM3U",
          "#EXT-X-STREAM-INF:BANDWIDTH=210560,RESOLUTION=704x576",
          "main_stream.m3u8?session=abc",
          "#EXT-X-MAP:URI=\"init.mp4\"",
        ].join("\n"),
      ),
    );
    const response = await call("cam1_sub");
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toContain("/api/hls/cam1_sub/main_stream.m3u8?session=abc");
    expect(body).toContain('URI="/api/hls/cam1_sub/init.mp4"');
    expect(body).not.toContain("mediamtx");
    expect(body).not.toContain("8888");
  });

  it("passes a segment through byte for byte with its content type", async () => {
    const segment = new Uint8Array([0x47, 0x40, 0x11, 0x10]);
    fetchMock.mockResolvedValue(upstream(segment, { headers: { "content-type": "video/mp2t" } }));
    const response = await call("cam1_sub", ["seg1.ts"]);
    const body = new Uint8Array(await response.arrayBuffer());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp2t");
    expect(Array.from(body)).toEqual(Array.from(segment));
  });

  it("accepts a 206 partial response instead of treating it as an error", async () => {
    fetchMock.mockResolvedValue(upstream(new Uint8Array([0x47]), { status: 206 }));
    const response = await call("cam1_sub", ["seg1.ts"]);
    expect(response.status).toBe(206);
  });

  it("maps upstream failures to safe statuses", async () => {
    fetchMock.mockResolvedValue(new Response("gone", { status: 404 }));
    expect((await call("cam1_sub")).status).toBe(404);

    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    expect((await call("cam1_sub")).status).toBe(502);
  });

  it("maps a network failure to 503", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    const response = await call("cam1_sub");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("mediamtx");
  });

  it("refuses an absurdly large playlist or segment", async () => {
    fetchMock.mockResolvedValue(upstream("x".repeat(1_000_001)));
    expect((await call("cam1_sub")).status).toBe(502);

    fetchMock.mockResolvedValue(upstream(new Uint8Array(20_000_001), { headers: { "content-type": "video/mp2t" } }));
    expect((await call("cam1_sub", ["seg1.ts"])).status).toBe(502);
  });

  it("never returns the gateway address or credentials", async () => {
    config.mediamtxAuthUser = "gateway";
    config.mediamtxAuthPassword = "secret";
    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const body = await (await call("cam1_sub")).text();
    // The app's own message may say "gateway"; the credentials and the address may not appear.
    expect(body).not.toContain("secret");
    expect(body).not.toContain("mediamtx");
    expect(body).not.toContain("8888");
    expect(body).not.toContain(Buffer.from("gateway:secret").toString("base64"));
  });
});
