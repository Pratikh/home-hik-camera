export type HikvisionErrorCode =
  | "not_configured"
  | "offline"
  | "auth_failed"
  | "bad_response"
  | "http_error";

export class HikvisionError extends Error {
  readonly code: HikvisionErrorCode;
  readonly status?: number;
  readonly body?: string;

  constructor(code: HikvisionErrorCode, message: string, status?: number, body?: string) {
    super(message);
    this.name = "HikvisionError";
    this.code = code;
    this.status = status;
    this.body = body;
  }
}

export type DeviceInfo = {
  name: string | null;
  model: string | null;
  serialNumber: string | null;
  firmware: string | null;
  encodingVersion: string | null;
  hardwareVersion: string | null;
  webVersion: string | null;
  pluginVersion: string | null;
  channelCount: number | null;
  deviceType: string | null;
};

export type DeviceStatus = {
  currentDeviceTime: string | null;
  deviceUpTime: string | null;
};

export type ChannelStatus = {
  id: number;
  name: string | null;
  online: boolean | null;
  enabled: boolean | null;
};

export type StorageSummary = {
  hddCount: number | null;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type HikvisionClientOptions = {
  host: string;
  port: number;
  username: string;
  password: string;
  fetchImpl?: FetchLike;
  timeoutMs?: number;
};
