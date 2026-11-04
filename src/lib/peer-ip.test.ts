import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPeerIp, installPeerIpCapture } from "@/lib/peer-ip";

/**
 * The socket peer address is what makes proxy-header trust verifiable. This test
 * uses a real Node HTTP server (the same transport Next uses) and proves that a
 * route handler can see the kernel's peer address while forged forwarding
 * headers are present.
 */
describe("peer IP capture", () => {
  let server: http.Server;
  let baseUrl: string;
  let observed: { peerIp: string | null; forwarded: string | null } | null = null;

  beforeAll(async () => {
    installPeerIpCapture();
    server = http.createServer((request, response) => {
      observed = {
        peerIp: getPeerIp(),
        forwarded: request.headers["x-forwarded-for"]?.toString() ?? null,
      };
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(observed));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("returns null outside a request scope", () => {
    expect(getPeerIp()).toBeNull();
  });

  it("captures the real peer even when the client forges X-Forwarded-For", async () => {
    const response = await fetch(`${baseUrl}/`, {
      headers: { "x-forwarded-for": "203.0.113.99", "cf-connecting-ip": "198.51.100.1" },
    });
    expect(response.status).toBe(200);
    expect(observed).not.toBeNull();
    expect(observed?.peerIp).toBe("127.0.0.1");
    // The header is still client-controlled, which is exactly why callers must
    // not use it unless the peer is a trusted proxy.
    expect(observed?.forwarded).toBe("203.0.113.99");
  });

  it("is idempotent when installed twice", async () => {
    installPeerIpCapture();
    installPeerIpCapture();
    const response = await fetch(`${baseUrl}/`);
    expect(response.status).toBe(200);
    expect(observed?.peerIp).toBe("127.0.0.1");
  });
});
