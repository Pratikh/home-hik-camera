import "server-only";
import { randomUUID } from "node:crypto";
import type { Recording } from "@/lib/recording";
import { DOWNLOAD_UNAVAILABLE } from "@/lib/recording";
import { hikvisionPlaybackStamp, kolkataRange } from "@/lib/time-kolkata";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import { parseSearchPage } from "@/server/hikvision/hikvision-playback-parse";
import { HikvisionError } from "@/server/hikvision/hikvision-types";

const SEARCH_PATH = "/ISAPI/ContentMgmt/search";
const PAGE_SIZE = 40;
const MAX_PAGES = 12;

export type PlaybackTarget = {
  host: string;
  port: number;
  username: string;
  password: string;
};

export type PlaybackSearchInput = {
  camera: number;
  date: string;
  startTime: string;
  endTime: string;
};

export type PlaybackTransport = {
  postXml(pathname: string, xml: string, timeoutMs?: number): Promise<string>;
};

function xmlEscape(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

export function searchDescription(input: {
  searchId: string;
  track: number;
  start: Date;
  end: Date;
  position: number;
}): string {
  const start = hikvisionPlaybackStamp(input.start);
  const end = hikvisionPlaybackStamp(input.end);
  const startIso = `${start.slice(0, 4)}-${start.slice(4, 6)}-${start.slice(6, 8)}T${start.slice(9, 11)}:${start.slice(11, 13)}:${start.slice(13, 15)}+05:30`;
  const endIso = `${end.slice(0, 4)}-${end.slice(4, 6)}-${end.slice(6, 8)}T${end.slice(9, 11)}:${end.slice(11, 13)}:${end.slice(13, 15)}+05:30`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<CMSearchDescription>
  <searchID>${xmlEscape(input.searchId)}</searchID>
  <trackIDList><trackID>${input.track}</trackID></trackIDList>
  <timeSpanList><timeSpan>
    <startTime>${startIso}</startTime>
    <endTime>${endIso}</endTime>
  </timeSpan></timeSpanList>
  <maxResults>${PAGE_SIZE}</maxResults>
  <searchResultPostion>${input.position}</searchResultPostion>
  <metadataList><metadataDescriptor>//recordType.meta.std-cgi.com</metadataDescriptor></metadataList>
</CMSearchDescription>`;
}

function isSafeHost(host: string): boolean {
  return host.length > 0 && host.length <= 253 && /^[A-Za-z0-9._:-]+$/.test(host);
}

export function buildPlaybackRtsp(input: {
  host: string;
  port: number;
  username: string;
  password: string;
  track: number;
  start: Date;
  end: Date;
}): string {
  if (!isSafeHost(input.host) || !Number.isInteger(input.port) || input.port < 1 || input.port > 65535) {
    throw new HikvisionError("not_configured", "DVR not configured");
  }
  if (!Number.isInteger(input.track) || input.track < 101 || input.track > 401) {
    throw new HikvisionError("bad_response", "Invalid camera");
  }
  const host = input.host.includes(":") && !input.host.startsWith("[") ? `[${input.host}]` : input.host;
  const start = hikvisionPlaybackStamp(input.start);
  const end = hikvisionPlaybackStamp(input.end);
  return `rtsp://${encodeURIComponent(input.username)}:${encodeURIComponent(input.password)}@${host}:${input.port}/Streaming/tracks/${input.track}/?starttime=${start}&endtime=${end}`;
}

export function dedupeRecordings(recordings: Recording[]): Recording[] {
  const seen = new Set<string>();
  const unique: Recording[] = [];
  for (const recording of recordings) {
    const key = `${recording.camera}|${recording.startTime}|${recording.endTime}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(recording);
  }
  unique.sort((left, right) => left.startTime.localeCompare(right.startTime));
  return unique;
}

export async function searchRecordings(transport: PlaybackTransport, input: PlaybackSearchInput): Promise<Recording[]> {
  const range = kolkataRange(input.date, input.startTime, input.endTime);
  if (!range) throw new HikvisionError("bad_response", "Invalid time");
  const track = input.camera * 100 + 1;
  const searchId = randomUUID();
  const collected: Recording[] = [];
  let position = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const xml = await transport.postXml(
      SEARCH_PATH,
      searchDescription({ searchId, track, start: range.start, end: range.end, position }),
    );
    const parsed = parseSearchPage(xml, input.camera);
    collected.push(...parsed.recordings);
    if (!parsed.more || parsed.recordings.length === 0) break;
    position += parsed.recordings.length;
  }
  return dedupeRecordings(collected).filter((recording) => {
    const start = new Date(recording.startTime).getTime();
    const end = new Date(recording.endTime).getTime();
    return end > range.start.getTime() && start < range.end.getTime();
  });
}

export class HikvisionPlaybackClient {
  constructor(
    private readonly transport: PlaybackTransport,
    private readonly target: PlaybackTarget,
  ) {}

  searchRecordings(input: PlaybackSearchInput): Promise<Recording[]> {
    return searchRecordings(this.transport, input);
  }

  getRecording(recordings: Recording[], id: string): Recording | null {
    return recordings.find((recording) => recording.id === id) ?? null;
  }

  getPlaybackUrl(recording: Recording, from?: Date): string {
    const start = from ?? new Date(recording.startTime);
    const end = new Date(recording.endTime);
    const recordingStart = new Date(recording.startTime);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start.getTime() >= end.getTime()) {
      throw new HikvisionError("bad_response", "Invalid time");
    }
    if (start.getTime() < recordingStart.getTime() || start.getTime() >= end.getTime()) {
      throw new HikvisionError("bad_response", "Invalid time");
    }
    return buildPlaybackRtsp({
      ...this.target,
      track: recording.camera * 100 + 1,
      start,
      end,
    });
  }

  downloadRecording(): typeof DOWNLOAD_UNAVAILABLE {
    return DOWNLOAD_UNAVAILABLE;
  }
}

export function playbackClientFrom(client: HikvisionClient, target: PlaybackTarget): HikvisionPlaybackClient {
  return new HikvisionPlaybackClient(client, target);
}
