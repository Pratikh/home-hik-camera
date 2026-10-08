import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import { buildDigestAuthorization, parseDigestChallenge } from "@/server/hikvision/hikvision-digest";
import { parseChannels } from "@/server/hikvision/hikvision-parse";
import { HikvisionError } from "@/server/hikvision/hikvision-types";

const deviceXml = `<?xml version="1.0" encoding="UTF-8"?>
<DeviceInfo version="2.0" xmlns="http://www.hikvision.com/ver20/XMLSchema">
  <deviceName>Home DVR</deviceName>
  <model>DS-7104HGHI-K1</model>
  <serialNumber>ABC123</serialNumber>
  <firmwareVersion>V4.83.401</firmwareVersion>
  <firmwareReleasedDate>build 241110</firmwareReleasedDate>
  <encoderVersion>V5.0</encoderVersion>
  <encoderReleasedDate>build 241106</encoderReleasedDate>
  <hardwareVersion>0xe9700</hardwareVersion>
</DeviceInfo>`;

describe("digest authentication", () => {
  it("matches the RFC 2617 example", () => {
    const header = buildDigestAuthorization({
      method: "GET",
      uri: "/dir/index.html",
      username: "Mufasa",
      password: "Circle Of Life",
      cnonce: "0a4f113b",
      nc: "00000001",
      challenge: {
        realm: "testrealm@host.com",
        nonce: "dcd98b7102dd2f0e8b11d0f600bfb0c093",
        opaque: "5ccc069c403ebaf9f0171e9517f40e41",
        qop: "auth",
      },
    });
    expect(createHash("md5").update("Mufasa:testrealm@host.com:Circle Of Life").digest("hex")).toBe(
      "939e7578ed9e3c518a452acee763bce9",
    );
    expect(header).toContain('response="6629fae49393a05397450978507c4ef1"');
    expect(parseDigestChallenge('Digest realm="testrealm@host.com", nonce="abc", qop="auth"')?.realm).toBe(
      "testrealm@host.com",
    );
  });
});

describe("HikvisionClient", () => {
  it("sends digest on the retry and parses device XML", async () => {
    const calls: Array<{ url: string; authorization?: string }> = [];
    const client = new HikvisionClient({
      host: "10.0.0.5",
      port: 80,
      username: "admin",
      password: "s3cret-password",
      fetchImpl: async (url, init) => {
        const headers = new Headers(init?.headers);
        calls.push({ url, authorization: headers.get("authorization") ?? undefined });
        if (calls.length === 1) {
          return new Response("unauthorized", {
            status: 401,
            headers: { "www-authenticate": 'Digest realm="IP Camera(C1234)", nonce="nonce-1", qop="auth"' },
          });
        }
        return new Response(deviceXml, { status: 200 });
      },
    });
    const info = await client.getDeviceInfo();
    expect(info.model).toBe("DS-7104HGHI-K1");
    expect(info.firmware).toBe("V4.83.401 build 241110");
    expect(info.encodingVersion).toBe("V5.0 build 241106");
    expect(info.hardwareVersion).toBe("0xe9700");
    expect(calls[1]?.authorization).toContain("Digest ");
    expect(calls[1]?.authorization).toContain('username="admin"');
    expect(calls[1]?.authorization).toContain('uri="/ISAPI/System/deviceInfo"');
    expect(calls[1]?.authorization).not.toContain("s3cret-password");
    expect(calls[0]?.url).toBe("http://10.0.0.5:80/ISAPI/System/deviceInfo");
  });

  it("maps transport failures, auth failures, and a missing host", async () => {
    const offline = new HikvisionClient({
      host: "10.0.0.5",
      port: 80,
      username: "admin",
      password: "s3cret-password",
      fetchImpl: async () => {
        throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
      },
    });
    await expect(offline.getDeviceInfo()).rejects.toMatchObject({ code: "offline", message: "DVR offline" });

    const denied = new HikvisionClient({
      host: "10.0.0.5",
      port: 80,
      username: "admin",
      password: "s3cret-password",
      fetchImpl: async (_url, init) => {
        const headers = new Headers(init?.headers);
        if (!headers.get("authorization")) {
          return new Response("", {
            status: 401,
            headers: { "www-authenticate": 'Digest realm="IP Camera", nonce="nonce-1", qop="auth"' },
          });
        }
        return new Response("no", { status: 401 });
      },
    });
    await expect(denied.getDeviceInfo()).rejects.toBeInstanceOf(HikvisionError);
    await expect(denied.getDeviceInfo()).rejects.toMatchObject({
      code: "auth_failed",
      message: "DVR authentication failed",
    });

    const missing = new HikvisionClient({
      host: "",
      port: 80,
      username: "admin",
      password: "s3cret-password",
      fetchImpl: async () => new Response("no"),
    });
    await expect(missing.getDeviceInfo()).rejects.toMatchObject({ code: "not_configured" });
  });

  it("parses channel lists and signal status", () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<VideoInputChannelList>
  <VideoInputChannel><id>1</id><name>Door</name><videoInputEnabled>true</videoInputEnabled></VideoInputChannel>
  <VideoInputChannel><id>2</id><name>Yard</name><videoInputEnabled>true</videoInputEnabled></VideoInputChannel>
</VideoInputChannelList>`;
    expect(parseChannels(xml).map((channel) => channel.id)).toEqual([1, 2]);
    const proxy = `<InputProxyChannelStatusList>
      <InputProxyChannelStatus><id>201</id><sourceInputPortDescriptor><online>true</online></sourceInputPortDescriptor></InputProxyChannelStatus>
    </InputProxyChannelStatusList>`;
    expect(parseChannels(proxy)).toEqual([
      expect.objectContaining({ id: 2, online: true }),
    ]);
  });
});
