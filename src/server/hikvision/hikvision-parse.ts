import { XMLParser } from "fast-xml-parser";
import { HikvisionError, type ChannelStatus, type DeviceInfo, type DeviceStatus, type StorageSummary } from "@/server/hikvision/hikvision-types";

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (tagName) =>
    ["VideoInputChannel", "VideoInputChannelStatus", "InputProxyChannelStatus", "StreamingChannel", "hdd"].includes(
      tagName,
    ),
});

export function isNotSupport(xml: string): boolean {
  return xml.toLowerCase().includes("notsupport");
}

export function parseXml(xml: string): unknown {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<")) {
    throw new HikvisionError("bad_response", "DVR returned an unexpected response");
  }
  try {
    return parser.parse(trimmed);
  } catch {
    throw new HikvisionError("bad_response", "DVR returned an unexpected response");
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function text(record: Record<string, unknown>, ...keys: string[]): string | null {
  const entries = new Map(Object.entries(record).map(([key, value]) => [key.toLowerCase(), value]));
  for (const key of keys) {
    const value = entries.get(key.toLowerCase());
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return null;
}

function boolish(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "yes" || normalized === "1") return true;
  if (normalized === "false" || normalized === "no" || normalized === "0") return false;
  return null;
}

function findRecord(node: unknown, key: string): Record<string, unknown> | null {
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findRecord(item, key);
      if (found) return found;
    }
    return null;
  }
  const record = asRecord(node);
  if (!record) return null;
  for (const [name, value] of Object.entries(record)) {
    if (name.toLowerCase() === key.toLowerCase()) {
      const direct = asRecord(value);
      if (direct) return direct;
    }
  }
  for (const value of Object.values(record)) {
    const found = findRecord(value, key);
    if (found) return found;
  }
  return null;
}

function nestedValue(record: Record<string, unknown>, key: string): unknown {
  for (const [name, value] of Object.entries(record)) {
    if (name.toLowerCase() === key.toLowerCase()) return value;
  }
  for (const value of Object.values(record)) {
    const child = asRecord(value);
    if (!child) continue;
    const found = nestedValue(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

function nestedText(record: Record<string, unknown>, key: string): string | null {
  const value = nestedValue(record, key);
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function joinVersion(version: string | null, released: string | null): string | null {
  if (version && released) return `${version} ${released}`;
  return version ?? released;
}

function collectRecords(node: unknown, key: string, found: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(node)) {
    for (const item of node) collectRecords(item, key, found);
    return found;
  }
  const record = asRecord(node);
  if (!record) return found;
  for (const [name, value] of Object.entries(record)) {
    if (name.toLowerCase() === key.toLowerCase()) {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        const child = asRecord(item);
        if (child) found.push(child);
      }
    }
    collectRecords(value, key, found);
  }
  return found;
}

function containsKey(node: unknown, key: string): boolean {
  if (Array.isArray(node)) return node.some((item) => containsKey(item, key));
  const record = asRecord(node);
  if (!record) return false;
  for (const [name, value] of Object.entries(record)) {
    if (name.toLowerCase() === key.toLowerCase()) return true;
    if (containsKey(value, key)) return true;
  }
  return false;
}

export function parseDeviceInfo(xml: string): DeviceInfo {
  const info = findRecord(parseXml(xml), "DeviceInfo");
  if (!info) throw new HikvisionError("bad_response", "DVR returned an unexpected response");
  const channelRaw = text(info, "channelNum", "videoInputPortNums", "videoChannelNum");
  const channelCount = channelRaw && /^\d+$/.test(channelRaw) ? Number(channelRaw) : null;
  return {
    name: text(info, "deviceName"),
    model: text(info, "model"),
    serialNumber: text(info, "serialNumber"),
    firmware: joinVersion(text(info, "firmwareVersion"), text(info, "firmwareReleasedDate")),
    encodingVersion: joinVersion(text(info, "encoderVersion"), text(info, "encoderReleasedDate")),
    hardwareVersion: text(info, "hardwareVersion"),
    webVersion: text(info, "webVersion", "webClientVersion"),
    pluginVersion: text(info, "pluginVersion"),
    channelCount,
    deviceType: text(info, "deviceType"),
  };
}

export function parseDeviceStatus(xml: string): DeviceStatus {
  const status = findRecord(parseXml(xml), "DeviceStatus") ?? {};
  return {
    currentDeviceTime: text(status, "currentDeviceTime"),
    deviceUpTime: text(status, "deviceUpTime"),
  };
}

function cameraIdFromChannel(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  if (value <= 0) return null;
  return value >= 100 ? Math.floor(value / 100) : value;
}

function readOnline(record: Record<string, unknown>): boolean | null {
  if (boolish(nestedValue(record, "videoLoss")) === true) return false;
  const online = boolish(nestedValue(record, "online"));
  if (online !== null) return online;
  const resolution = nestedText(record, "resDesc");
  if (resolution && resolution !== "0*0" && resolution !== "0") return true;
  return null;
}

export function parseChannels(xml: string): ChannelStatus[] {
  const doc = parseXml(xml);
  const tags = ["VideoInputChannel", "VideoInputChannelStatus", "InputProxyChannelStatus", "StreamingChannel"];
  const records = tags.flatMap((tag) => collectRecords(doc, tag));
  const byId = new Map<number, ChannelStatus>();
  for (const record of records) {
    const id = cameraIdFromChannel(text(record, "id"));
    if (!id || id > 32) continue;
    const next: ChannelStatus = {
      id,
      name: text(record, "name"),
      online: readOnline(record),
      enabled: boolish(nestedValue(record, "videoInputEnabled")),
    };
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, next);
      continue;
    }
    byId.set(id, {
      id,
      name: next.name ?? existing.name,
      online: next.online ?? existing.online,
      enabled: next.enabled ?? existing.enabled,
    });
  }
  return [...byId.values()].sort((left, right) => left.id - right.id);
}

export function mergeChannelLists(current: ChannelStatus[], incoming: ChannelStatus[]): ChannelStatus[] {
  const byId = new Map<number, ChannelStatus>();
  for (const item of [...current, ...incoming]) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    byId.set(item.id, {
      id: item.id,
      name: item.name ?? existing.name,
      online: item.online ?? existing.online,
      enabled: item.enabled ?? existing.enabled,
    });
  }
  return [...byId.values()].sort((left, right) => left.id - right.id);
}

export function parseStorage(xml: string): StorageSummary {
  if (isNotSupport(xml)) return { hddCount: null };
  const doc = parseXml(xml);
  const disks = collectRecords(doc, "hdd");
  if (disks.length > 0) return { hddCount: disks.length };
  if (containsKey(doc, "hddList") || containsKey(doc, "hdd")) return { hddCount: 0 };
  return { hddCount: null };
}
