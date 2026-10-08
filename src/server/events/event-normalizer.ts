import { createHash } from "node:crypto";
import { XMLParser } from "fast-xml-parser";
import { dedupeKey, type EventClassification, type EventType } from "@/lib/events";
import { formatKolkataIso, parseDvrTimestamp } from "@/lib/time-kolkata";

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (tagName) => tagName === "searchMatchItem",
});

export type MotionStart = {
  id: string;
  dedupeKey: string;
  cameraId: number;
  type: "motion";
  classification: EventClassification | null;
  timestamp: string;
  timeMs: number;
  endTimestamp: string | null;
  source: "hikvision";
  metaId: string;
};

export type MotionStop = {
  cameraId: number;
  timeMs: number;
  timestamp: string;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function field(record: Record<string, unknown>, key: string): unknown {
  for (const [name, value] of Object.entries(record)) {
    if (name.toLowerCase() === key.toLowerCase()) return value;
  }
  return undefined;
}

function textValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

export function classificationFromAddition(addition: string | null): EventClassification | null {
  const value = (addition ?? "").trim().toLowerCase();
  if (value === "human" || value === "person") return "person";
  if (value === "vehicle") return "vehicle";
  return null;
}

export function eventIdFor(key: string): string {
  return `evt_${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
}

function parseMeta(metaId: string): { kind: "start" | "stop"; cameraId: number } | null {
  const match = /\/Alarm\/motion(Start|Stop)\/([1-4])$/i.exec(metaId);
  if (!match) return null;
  return { kind: match[1].toLowerCase() === "start" ? "start" : "stop", cameraId: Number(match[2]) };
}

export function parseAlarmLogs(xml: string): { starts: MotionStart[]; stops: MotionStop[]; matches: number; more: boolean } {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<")) return { starts: [], stops: [], matches: 0, more: false };
  let parsed: unknown;
  try {
    parsed = parser.parse(trimmed);
  } catch {
    return { starts: [], stops: [], matches: 0, more: false };
  }
  const root = asRecord(parsed);
  const result = root ? asRecord(field(root, "CMSearchResult")) ?? root : null;
  if (!result) return { starts: [], stops: [], matches: 0, more: false };
  const more = (textValue(field(result, "responseStatusStrg")) ?? "").toUpperCase() === "MORE";
  const matchList = asRecord(field(result, "matchList"));
  const items = matchList ? field(matchList, "searchMatchItem") : undefined;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  const starts: MotionStart[] = [];
  const stops: MotionStop[] = [];
  for (const item of list) {
    const record = asRecord(item);
    const descriptor = record ? asRecord(field(record, "logDescriptor")) ?? record : null;
    if (!descriptor) continue;
    const metaId = textValue(field(descriptor, "metaId"));
    const when = parseDvrTimestamp(textValue(field(descriptor, "StartDateTime")) ?? "");
    if (!metaId || !when) continue;
    const parsedMeta = parseMeta(metaId);
    if (!parsedMeta) continue;
    const timestamp = formatKolkataIso(when);
    if (parsedMeta.kind === "stop") {
      stops.push({ cameraId: parsedMeta.cameraId, timeMs: when.getTime(), timestamp });
      continue;
    }
    const classification = classificationFromAddition(textValue(field(descriptor, "additionInformation")));
    const key = dedupeKey({ cameraId: parsedMeta.cameraId, type: "motion", timestamp, classification });
    starts.push({
      id: eventIdFor(key),
      dedupeKey: key,
      cameraId: parsedMeta.cameraId,
      type: "motion",
      classification,
      timestamp,
      timeMs: when.getTime(),
      endTimestamp: null,
      source: "hikvision",
      metaId,
    });
  }
  return { starts, stops, matches: list.length, more };
}

export function attachStops(starts: MotionStart[], stops: MotionStop[]): { events: MotionStart[]; leftoverStops: MotionStop[] } {
  const events = [...starts].sort((left, right) => left.timeMs - right.timeMs).map((start) => ({ ...start }));
  const leftover: MotionStop[] = [];
  for (const stop of [...stops].sort((left, right) => left.timeMs - right.timeMs)) {
    let match = -1;
    for (let index = events.length - 1; index >= 0; index -= 1) {
      const event = events[index];
      if (!event || event.cameraId !== stop.cameraId || event.endTimestamp || event.timeMs > stop.timeMs) continue;
      match = index;
      break;
    }
    const chosen = match >= 0 ? events[match] : undefined;
    if (!chosen) {
      leftover.push(stop);
      continue;
    }
    chosen.endTimestamp = stop.timestamp;
  }
  return { events, leftoverStops: leftover };
}

export function supportedEventTypes(): EventType[] {
  return ["motion"];
}
