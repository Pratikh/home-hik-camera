import "server-only";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/config";
import { shouldNotify } from "@/lib/events";
import { formatKolkataIso, kolkataDayBounds, todayInKolkata } from "@/lib/time-kolkata";
import { createAIProvider } from "@/server/ai/ai-provider";
import { readCameraNames } from "@/server/cameras/store";
import { attachStops, parseAlarmLogs, type MotionStart, type MotionStop } from "@/server/events/event-normalizer";
import { publishLiveEvent } from "@/server/events/event-hub";
import { openEventStore, type NewEvent } from "@/server/events/event-store";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import { HikvisionError } from "@/server/hikvision/hikvision-types";

const seenDuplicates = new Set<string>();
let started = false;
let polling = false;
let lastPoll: string | null = null;
let lastError: string | null = null;
let backfilled = false;

export function eventIngestionStatus(): { running: boolean; lastPoll: string | null; lastError: string | null } {
  return { running: started, lastPoll, lastError };
}

export function ensureEventProcessor(): void {
  if (started) return;
  started = true;
  const config = getConfig();
  console.info("[events] DVR event polling started");
  void poll(true);
  setInterval(() => void poll(false), config.eventPollIntervalMs);
  setInterval(() => cleanup(), 60 * 60 * 1000);
}

function searchXml(searchId: string, start: Date, end: Date, position: number): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<CMSearchDescription>
  <searchID>${searchId}</searchID>
  <metaId>log.std-cgi.com/Alarm</metaId>
  <timeSpanList><timeSpan>
    <startTime>${formatKolkataIso(start)}</startTime>
    <endTime>${formatKolkataIso(end)}</endTime>
  </timeSpan></timeSpanList>
  <maxResults>40</maxResults>
  <searchResultPostion>${position}</searchResultPostion>
</CMSearchDescription>`;
}

async function fetchLogs(client: HikvisionClient, start: Date, end: Date): Promise<{ starts: MotionStart[]; stops: MotionStop[] }> {
  const searchId = randomUUID();
  const starts: MotionStart[] = [];
  const stops: MotionStop[] = [];
  let position = 0;
  for (let page = 0; page < 15; page += 1) {
    const xml = await client.postXml("/ISAPI/ContentMgmt/logSearch", searchXml(searchId, start, end, position));
    const parsed = parseAlarmLogs(xml);
    starts.push(...parsed.starts);
    stops.push(...parsed.stops);
    if (!parsed.more || parsed.matches === 0) break;
    position += parsed.matches;
  }
  return { starts, stops };
}

function toNewEvent(event: MotionStart): NewEvent {
  return {
    id: event.id,
    dedupeKey: event.dedupeKey,
    cameraId: event.cameraId,
    type: event.type,
    classification: event.classification,
    timestamp: event.timestamp,
    endTimestamp: event.endTimestamp,
    source: event.source,
    metaId: event.metaId,
  };
}

async function poll(backfill: boolean): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    const config = getConfig();
    if (!config.dvrConfigured || config.eventDevMock) {
      lastError = config.dvrConfigured ? null : "not_configured";
      return;
    }
    const now = new Date();
    const day = kolkataDayBounds(todayInKolkata(now));
    const start = backfill && !backfilled && day ? day.start : new Date(now.getTime() - Math.max(config.eventPollIntervalMs * 3, 120_000));
    const client = new HikvisionClient({
      host: config.dvrHost,
      port: config.dvrHttpPort,
      username: config.dvrUsername,
      password: config.dvrPassword,
      timeoutMs: 12000,
    });
    const logs = await fetchLogs(client, start, now);
    const paired = attachStops(logs.starts, logs.stops);
    const store = openEventStore(config.dataDir);
    const names = await readCameraNames(config.dataDir);
    const notifyAfter = now.getTime() - Math.max(config.eventPollIntervalMs * 3, 120_000);
    const rules = store.rules();
    const ai = createAIProvider(config.aiEnabled);
    for (const event of paired.events) {
      const inserted = store.insertEvent(toNewEvent(event));
      if (!inserted) {
        if (!seenDuplicates.has(event.dedupeKey)) {
          seenDuplicates.add(event.dedupeKey);
          console.info("[events] Duplicate event ignored");
        }
        continue;
      }
      console.info("[events] New event detected");
      console.info("[events] Event stored");
      if (config.aiEnabled) {
        console.info("[events] AI processing started");
        const analysis = await ai.analyzeImage({ eventId: event.id, classification: event.classification });
        console.info("[events] AI processing completed");
        if (analysis) {
          store.saveAiResult({
            eventId: event.id,
            provider: ai.name,
            label: analysis.label,
            confidence: analysis.confidence,
          });
        }
      }
      const at = new Date(event.timestamp);
      const recent = at.getTime() >= notifyAfter;
      const decision = recent ? shouldNotify(rules, event, at) : { matched: false, quiet: false, notify: false };
      if (decision.matched) console.info("[events] Notification rule matched");
      if (decision.quiet) console.info("[events] Notification suppressed by quiet hours");
      const stored = store.get(event.id);
      if (stored) {
        publishLiveEvent({
          notify: decision.notify,
          event: { ...stored, cameraName: names[event.cameraId] ?? `Camera ${event.cameraId}` },
        });
      }
    }
    for (const stop of paired.leftoverStops) store.closeOpenEvent(stop.cameraId, stop.timestamp);
    if (backfill) backfilled = true;
    lastPoll = new Date().toISOString();
    lastError = null;
    store.setSetting("events_last_poll", lastPoll);
    store.setSetting("events_last_error", "");
  } catch (error) {
    lastError = error instanceof HikvisionError ? error.code : "error";
    console.error("[events] poll", error instanceof Error ? error.name : "error");
    try {
      openEventStore(getConfig().dataDir).setSetting("events_last_error", lastError);
    } catch {
      // The database itself may be the failure.
    }
  } finally {
    polling = false;
  }
}

function cleanup(): void {
  try {
    const config = getConfig();
    const store = openEventStore(config.dataDir);
    const override = store.setting("retention_days");
    const days = override && /^\d+$/.test(override) ? Number(override) : config.eventRetentionDays;
    if (days <= 0) return;
    const cutoff = formatKolkataIso(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    const removed = store.deleteOlderThan(cutoff);
    if (removed > 0) console.info("[events] retention removed", removed);
  } catch (error) {
    console.error("[events] retention", error instanceof Error ? error.name : "error");
  }
}
