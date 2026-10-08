import "server-only";
import type { DeviceDetails, DvrState } from "@/lib/api-types";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import { HikvisionError, type ChannelStatus, type DeviceInfo, type DeviceStatus, type StorageSummary } from "@/server/hikvision/hikvision-types";

export type HikvisionApi = {
  getDeviceInfo(): Promise<DeviceInfo>;
  getDeviceStatus(): Promise<DeviceStatus>;
  getChannelStatus(): Promise<ChannelStatus[]>;
  getStorage(): Promise<StorageSummary>;
};

export type DvrOverview = {
  state: DvrState;
  message: string;
  device: DeviceDetails | null;
  channels: ChannelStatus[] | null;
};

function blank(state: DvrState, message: string): DvrOverview {
  return { state, message, device: null, channels: null };
}

function rethrowIfFatal(error: unknown): void {
  if (
    error instanceof HikvisionError &&
    (error.code === "auth_failed" || error.code === "offline" || error.code === "not_configured")
  ) {
    throw error;
  }
}

export async function readDvrOverview(client: HikvisionApi): Promise<DvrOverview> {
  try {
    const info = await client.getDeviceInfo();
    const [status, channels, storage] = await Promise.all([
      client.getDeviceStatus().catch((error: unknown) => {
        rethrowIfFatal(error);
        return null;
      }),
      client.getChannelStatus().catch((error: unknown) => {
        rethrowIfFatal(error);
        return null;
      }),
      client.getStorage().catch((error: unknown) => {
        rethrowIfFatal(error);
        return null;
      }),
    ]);
    const channelCount =
      info.channelCount ?? (channels && channels.length > 0 ? channels.length : null);
    return {
      state: "connected",
      message: Messages.dvrConnected,
      channels,
      device: {
        name: info.name,
        model: info.model,
        serialNumber: info.serialNumber,
        firmware: info.firmware,
        encodingVersion: info.encodingVersion,
        hardwareVersion: info.hardwareVersion,
        webVersion: info.webVersion,
        pluginVersion: info.pluginVersion,
        channelCount,
        hddCount: storage?.hddCount ?? null,
        currentDeviceTime: status?.currentDeviceTime ?? null,
      },
    };
  } catch (error) {
    const mapped =
      error instanceof HikvisionError ? error : new HikvisionError("offline", Messages.dvrOffline);
    console.error("[dvr]", mapped.code, mapped.status ?? "");
    if (mapped.code === "not_configured") return blank("not_configured", Messages.dvrNotConfigured);
    if (mapped.code === "auth_failed") return blank("auth_failed", Messages.dvrAuthFailed);
    if (mapped.code === "offline") return blank("disconnected", Messages.dvrOffline);
    return blank("disconnected", Messages.dvrUnexpected);
  }
}

let cached: { at: number; value: DvrOverview } | null = null;
let inflight: Promise<DvrOverview> | null = null;

function cacheTtl(state: DvrState): number {
  if (state === "auth_failed") return 60_000;
  if (state === "disconnected") return 10_000;
  return 8_000;
}

export async function getDvrOverview(): Promise<DvrOverview> {
  const config = getConfig();
  if (!config.dvrConfigured) {
    if (config.dvrErrors.length > 0) return blank("disconnected", Messages.invalidConfig);
    return blank("not_configured", Messages.dvrNotConfigured);
  }
  const now = Date.now();
  if (cached && now - cached.at < cacheTtl(cached.value.state)) return cached.value;
  if (inflight) return inflight;
  inflight = readDvrOverview(
    new HikvisionClient({
      host: config.dvrHost,
      port: config.dvrHttpPort,
      username: config.dvrUsername,
      password: config.dvrPassword,
    }),
  )
    .then((value) => {
      cached = { at: Date.now(), value };
      return value;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

export function resetDvrCache(): void {
  cached = null;
  inflight = null;
}
