import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

/**
 * The WHEP (WebRTC) signalling proxy.
 *
 * The Hub is the only thing the browser talks to: the SDP offer goes to the Hub,
 * the Hub forwards it to MediaMTX, and the returned session location is rewritten
 * to a same-origin URL. MediaMTX is mocked here.
 */

const currentUser = vi.fn();
const config = {
  mediamtxWhepUrl: "http://mediamtx:8889",
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

const { POST } = await import("@/app/api/webrtc/[path]/whep/route");

const ADMIN = { username: "home", role: "ADMIN", userId: "u1", sessionId: "s1" };
const OFFER = "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\ns=-\r\n";

function call(path: string, body: string | null = OFFER, headers: Record<string, string> = {}) {
  return POST(
    new Request(`http://localhost:3000/api/webrtc/${path}/whep`, {
      method: "POST",
      headers: { "content-type": "application/sdp", ...headers },
      body,
    }),
    { params: Promise.resolve({ path }) },
  );
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

describe("WHEP proxy — access control and validation", () => {
  it("refuses an anonymous caller before touching the gateway", async () => {
    currentUser.mockReturnValue(null);
    const response = await call("cam1_sub");
    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("404s a path that is not a relay path", async () => {
    const response = await call("nope");
    expect(response.status).toBe(404);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("400s an empty or oversized offer", async () => {
    expect((await call("cam1_sub", "")).status).toBe(400);
    expect((await call("cam1_sub", "x".repeat(1_000_001))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("WHEP proxy — signalling contract", () => {
  it("forwards the offer and returns the answer with a same-origin session location", async () => {
    fetchMock.mockResolvedValue(
      new Response("v=0\r\na=answer\r\n", {
        status: 201,
        headers: {
          "content-type": "application/sdp",
          location: "http://mediamtx:8889/cam1_sub/whep/abcd1234efgh",
        },
      }),
    );

    const response = await call("cam1_sub", OFFER, { origin: "https://hub.example" });

    expect(response.status).toBe(201);
    expect(response.headers.get("content-type")).toBe("application/sdp");
    expect(response.headers.get("cache-control")).toBe("no-store");
    // The session is rewritten to the Hub's own path, so the browser never sees
    // the gateway address.
    expect(response.headers.get("location")).toBe("/api/webrtc/cam1_sub/session/abcd1234efgh");
    expect(await response.text()).toContain("a=answer");

    const [url, init] = fetchMock.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://mediamtx:8889/cam1_sub/whep");
    expect(init.method).toBe("POST");
    expect(init.body).toBe(OFFER);
    const headers = init.headers as Headers;
    expect(headers.get("content-type")).toBe("application/sdp");
    expect(headers.get("origin")).toBe("https://hub.example");
  });

  it("omits the location when the gateway does not provide a usable session", async () => {
    fetchMock.mockResolvedValue(new Response("v=0\r\n", { status: 200, headers: { "content-type": "application/sdp" } }));
    const response = await call("cam1_sub");
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("adds gateway auth only when configured, and never exposes it", async () => {
    config.mediamtxAuthUser = "gateway";
    config.mediamtxAuthPassword = "secret";
    fetchMock.mockResolvedValue(new Response("v=0\r\n", { status: 200 }));

    await call("cam1_sub");
    const headers = (fetchMock.mock.calls[0]![1] as RequestInit).headers as Headers;
    expect(headers.get("authorization")).toBe(`Basic ${Buffer.from("gateway:secret").toString("base64")}`);

    fetchMock.mockResolvedValue(new Response("nope", { status: 500 }));
    const body = await (await call("cam1_sub")).text();
    expect(body).not.toContain("secret");
    expect(body).not.toContain("mediamtx");
    expect(body).not.toContain("8889");
  });

  it("maps upstream failures to safe statuses", async () => {
    fetchMock.mockResolvedValue(new Response("gone", { status: 404 }));
    expect((await call("cam1_sub")).status).toBe(404);

    fetchMock.mockResolvedValue(new Response("boom", { status: 500 }));
    expect((await call("cam1_sub")).status).toBe(502);

    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    expect((await call("cam1_sub")).status).toBe(503);
  });

  it("only rewrites a location that looks like a real session id", async () => {
    fetchMock.mockResolvedValue(
      new Response("v=0\r\n", { status: 201, headers: { location: "http://mediamtx:8889/cam1_sub/whep/../../etc" } }),
    );
    const response = await call("cam1_sub");
    expect(response.headers.get("location")).toBeNull();
  });
});
