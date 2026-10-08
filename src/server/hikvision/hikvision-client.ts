import "server-only";
import { buildDigestAuthorization, parseDigestChallenge } from "@/server/hikvision/hikvision-digest";
import {
  isNotSupport,
  mergeChannelLists,
  parseChannels,
  parseDeviceInfo,
  parseDeviceStatus,
  parseStorage,
} from "@/server/hikvision/hikvision-parse";
import {
  HikvisionError,
  type ChannelStatus,
  type DeviceInfo,
  type DeviceStatus,
  type FetchLike,
  type HikvisionClientOptions,
  type StorageSummary,
} from "@/server/hikvision/hikvision-types";

const OFFLINE_CODES = new Set([
  "ECONNREFUSED",
  "ENOTFOUND",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ECONNRESET",
  "ETIMEDOUT",
  "EAI_AGAIN",
]);

function asHikvisionError(error: unknown): HikvisionError {
  if (error instanceof HikvisionError) return error;
  if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
    return new HikvisionError("offline", "DVR offline");
  }
  const record = error as { code?: string; cause?: { code?: string } };
  const code = record?.code ?? record?.cause?.code;
  if (code && OFFLINE_CODES.has(code)) return new HikvisionError("offline", "DVR offline");
  if (error instanceof TypeError) return new HikvisionError("offline", "DVR offline");
  return new HikvisionError("offline", "DVR offline");
}

export class HikvisionClient {
  private readonly host: string;
  private readonly port: number;
  private readonly username: string;
  private readonly password: string;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;

  constructor(options: HikvisionClientOptions) {
    this.host = options.host.trim();
    this.port = options.port;
    this.username = options.username;
    this.password = options.password;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? 4000;
  }

  async getDeviceInfo(): Promise<DeviceInfo> {
    const body = await this.requestText("/ISAPI/System/deviceInfo");
    if (isNotSupport(body)) {
      throw new HikvisionError("http_error", "DVR returned an unexpected response", 404, body);
    }
    return parseDeviceInfo(body);
  }

  async getDeviceStatus(): Promise<DeviceStatus> {
    const body = await this.requestOptional("/ISAPI/System/status");
    if (!body) return { currentDeviceTime: null, deviceUpTime: null };
    try {
      return parseDeviceStatus(body);
    } catch (error) {
      const mapped = asHikvisionError(error);
      if (mapped.code === "offline" || mapped.code === "auth_failed" || mapped.code === "not_configured") throw mapped;
      return { currentDeviceTime: null, deviceUpTime: null };
    }
  }

  async getChannelStatus(): Promise<ChannelStatus[]> {
    const paths = [
      "/ISAPI/System/Video/inputs/channels",
      "/ISAPI/ContentMgmt/InputProxy/channels/status",
      "/ISAPI/Streaming/channels",
    ];
    let merged: ChannelStatus[] = [];
    for (const path of paths) {
      const body = await this.requestOptional(path);
      if (!body) continue;
      try {
        merged = mergeChannelLists(merged, parseChannels(body));
      } catch (error) {
        const mapped = asHikvisionError(error);
        if (mapped.code === "offline" || mapped.code === "auth_failed" || mapped.code === "not_configured") throw mapped;
      }
      if (merged.some((channel) => channel.online !== null)) return merged;
    }
    if (merged.length > 0 && merged.every((channel) => channel.online === null)) {
      return this.enrichChannelSignals(merged);
    }
    return merged;
  }

  async getStorage(): Promise<StorageSummary> {
    for (const path of ["/ISAPI/ContentMgmt/Storage/hdd", "/ISAPI/ContentMgmt/Storage"]) {
      const body = await this.requestOptional(path);
      if (!body) continue;
      try {
        const summary = parseStorage(body);
        if (summary.hddCount !== null) return summary;
      } catch (error) {
        const mapped = asHikvisionError(error);
        if (mapped.code === "offline" || mapped.code === "auth_failed" || mapped.code === "not_configured") throw mapped;
      }
    }
    return { hddCount: null };
  }

  private async enrichChannelSignals(channels: ChannelStatus[]): Promise<ChannelStatus[]> {
    const updates = await Promise.all(
      channels.slice(0, 8).map(async (channel) => {
        const body = await this.requestOptional(`/ISAPI/System/Video/inputs/channels/${channel.id}/status`);
        if (!body) return null;
        try {
          return parseChannels(body).find((item) => item.id === channel.id) ?? null;
        } catch {
          return null;
        }
      }),
    );
    return mergeChannelLists(
      channels,
      updates.filter((item): item is ChannelStatus => item !== null),
    );
  }

  private endpoint(pathname: string): { url: string; uri: string } {
    if (!this.host) throw new HikvisionError("not_configured", "DVR not configured");
    const host = this.host.includes(":") && !this.host.startsWith("[") ? `[${this.host}]` : this.host;
    const uri = pathname.startsWith("/") ? pathname : `/${pathname}`;
    return { url: `http://${host}:${this.port}${uri}`, uri };
  }

  private async requestOptional(pathname: string): Promise<string | null> {
    try {
      const body = await this.requestText(pathname);
      return isNotSupport(body) ? null : body;
    } catch (error) {
      const mapped = asHikvisionError(error);
      if (mapped.code === "offline" || mapped.code === "auth_failed" || mapped.code === "not_configured") throw mapped;
      return null;
    }
  }

  async postXml(pathname: string, xml: string, timeoutMs = 15000): Promise<string> {
    return this.requestText(pathname, { method: "POST", body: xml, timeoutMs });
  }

  private async requestText(
    pathname: string,
    options?: { method?: "GET" | "POST"; body?: string; timeoutMs?: number },
  ): Promise<string> {
    const method = options?.method ?? "GET";
    const timeoutMs = options?.timeoutMs ?? this.timeoutMs;
    const { url, uri } = this.endpoint(pathname);
    const headers: Record<string, string> = { Accept: "application/xml, text/xml, */*" };
    if (options?.body) headers["Content-Type"] = "application/xml";
    try {
      const first = await this.fetchImpl(url, {
        method,
        body: options?.body,
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(timeoutMs),
        headers,
      });
      if (first.status === 200) return first.text();
      if (first.status === 401) {
        const challenge = parseDigestChallenge(first.headers.get("www-authenticate") ?? "");
        if (!challenge) throw new HikvisionError("auth_failed", "DVR authentication failed", 401);
        const authorization = buildDigestAuthorization({
          method,
          uri,
          username: this.username,
          password: this.password,
          challenge,
        });
        const second = await this.fetchImpl(url, {
          method,
          body: options?.body,
          redirect: "manual",
          cache: "no-store",
          signal: AbortSignal.timeout(timeoutMs),
          headers: { ...headers, Authorization: authorization },
        });
        const body = await second.text();
        if (second.status === 401 || second.status === 403) {
          throw new HikvisionError("auth_failed", "DVR authentication failed", second.status, body);
        }
        if (second.status >= 400) {
          throw new HikvisionError("http_error", "DVR returned an unexpected response", second.status, body);
        }
        return body;
      }
      const body = await first.text();
      if (first.status >= 400) {
        throw new HikvisionError("http_error", "DVR returned an unexpected response", first.status, body);
      }
      return body;
    } catch (error) {
      throw asHikvisionError(error);
    }
  }
}
