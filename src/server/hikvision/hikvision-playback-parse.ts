import { XMLParser } from "fast-xml-parser";
import { normalizeRecordingType, recordingId, recordingLabel, type Recording } from "@/lib/recording";
import { formatKolkataIso, parseDvrTimestamp } from "@/lib/time-kolkata";
import { HikvisionError } from "@/server/hikvision/hikvision-types";

const parser = new XMLParser({
  ignoreAttributes: true,
  removeNSPrefix: true,
  trimValues: true,
  parseTagValue: false,
  isArray: (tagName) => tagName === "searchMatchItem",
});

export type SearchPage = {
  more: boolean;
  matches: number;
  recordings: Recording[];
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

function descriptorText(value: unknown): string | null {
  if (typeof value === "string") return value.trim() || null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = descriptorText(item);
      if (text) return text;
    }
    return null;
  }
  const record = asRecord(value);
  if (!record) return null;
  return textValue(field(record, "metadataDescriptor")) ?? descriptorText(field(record, "metadataMatches"));
}

function cameraFromTrack(trackId: number): number | null {
  if (!Number.isInteger(trackId) || trackId % 100 !== 1) return null;
  const camera = (trackId - 1) / 100;
  if (camera < 1 || camera > 4) return null;
  return camera;
}

export function parseSearchPage(xml: string, camera: number): SearchPage {
  const trimmed = xml.trim();
  if (!trimmed.startsWith("<")) {
    throw new HikvisionError("bad_response", "DVR returned an unexpected response");
  }
  if (trimmed.toLowerCase().includes("notsupport")) {
    throw new HikvisionError("http_error", "Playback unavailable", 404, trimmed);
  }
  let parsed: unknown;
  try {
    parsed = parser.parse(trimmed);
  } catch {
    throw new HikvisionError("bad_response", "DVR returned an unexpected response");
  }
  const root = asRecord(parsed);
  const result = root ? asRecord(field(root, "CMSearchResult")) ?? root : null;
  if (!result) throw new HikvisionError("bad_response", "DVR returned an unexpected response");
  const status = textValue(field(result, "responseStatus"));
  if (status && status.toLowerCase() === "false") {
    throw new HikvisionError("http_error", "DVR returned an unexpected response", 500, trimmed);
  }
  const more = (textValue(field(result, "responseStatusStrg")) ?? "").toUpperCase() === "MORE";
  const matches = Number(textValue(field(result, "numOfMatches")) ?? "0");
  const matchList = asRecord(field(result, "matchList"));
  const items = matchList ? field(matchList, "searchMatchItem") : undefined;
  const list = Array.isArray(items) ? items : items ? [items] : [];
  const recordings: Recording[] = [];
  for (const item of list) {
    const record = asRecord(item);
    if (!record) continue;
    const track = Number(textValue(field(record, "trackID")) ?? "");
    const owner = cameraFromTrack(track);
    if (owner !== camera) continue;
    const span = asRecord(field(record, "timeSpan"));
    if (!span) continue;
    const start = parseDvrTimestamp(textValue(field(span, "startTime")) ?? "");
    const end = parseDvrTimestamp(textValue(field(span, "endTime")) ?? "");
    if (!start || !end || end.getTime() <= start.getTime()) continue;
    const type = normalizeRecordingType(descriptorText(field(record, "metadataMatches")));
    recordings.push({
      id: recordingId(camera, start, end),
      camera,
      startTime: formatKolkataIso(start),
      endTime: formatKolkataIso(end),
      type,
      label: recordingLabel(type),
    });
  }
  return { more, matches: Number.isFinite(matches) ? matches : recordings.length, recordings };
}
