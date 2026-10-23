import "server-only";
import { randomUUID } from "node:crypto";
import { getConfig } from "@/lib/config";
import { formatKolkataIso, kolkataDayBounds, todayInKolkata } from "@/lib/time-kolkata";
import { defaultPriority } from "@/lib/priority";
import { effectiveDetectionSource } from "@/lib/object-detection";
import { createAIProvider } from "@/server/ai/ai-provider";
import { getCameraNameMap } from "@/server/cameras/names";
import { attachStops, parseAlarmLogs, type MotionStart, type MotionStop } from "@/server/events/event-normalizer";
import { processEventNotification } from "@/server/events/event-pipeline";
import { publishLiveEvent } from "@/server/events/event-hub";
import { openEventStore, type NewEvent } from "@/server/events/event-store";
import { objectDetectionConfig } from "@/server/detection/settings-store";
import { runRetention } from "@/server/events/retention";
import { captureEventSnapshotForPoll } from "@/server/events/snapshot";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import { HikvisionError } from "@/server/hikvision/hikvision-types";

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
    if (backfill && !backfilled) {
      // Diagnostic for the historical-event path: this poll re-reads the day,
      // so its events must not receive a "current" live still.
      console.info("[events] Backfill poll started");
    }
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
    const names = await getCameraNameMap(config.dataDir);
    // The Admin's detection-source choice decides whether DVR person/vehicle
    // events may notify. It is read once per poll (a single SQLite row) and only
    // applies while object detection is enabled: with detection OFF there are no
    // AI events to prefer, so the historical DVR behaviour must remain.
    const detectionSource = effectiveDetectionSource(objectDetectionConfig(config.dataDir).settings);
    const ai = createAIProvider(config.aiEnabled);
    for (const event of paired.events) {
      const priority = defaultPriority(event.type, event.classification);
      const inserted = store.insertEvent({ ...toNewEvent(event), priority });
      if (!inserted) {
        // The unique dedupe_key already blocks a repeated DVR message.
        console.info("[events] Duplicate event ignored");
        continue;
      }
      console.info("[events] New event detected");

      const at = new Date(event.timestamp);
      const cameraName = names[event.cameraId] ?? `Camera ${event.cameraId}`;

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

      /*
       * A still picture is optional. The event is already stored, so a DVR that
       * cannot serve one just leaves the snapshot unavailable.
       *
       * The DVR's alarm log carries no frame, and its picture endpoint only
       * returns the live frame, so a still is only meaningful for an event that
       * was just discovered. On the startup backfill the events are hours old:
       * capturing "now" for them would attach an unrelated image to the event
       * and to its Telegram media. Historical events therefore stay snapshot-less.
       */
      const snapshot = await captureEventSnapshotForPoll({
        cameraId: event.cameraId,
        eventId: event.id,
        at,
        client,
        backfill,
        eventTimestamp: event.timestamp,
      });
      if (snapshot) {
        store.setSnapshotPath(event.id, snapshot);
      } else if (backfill) {
        console.info("[events] Backfilled event stored without a live snapshot");
      } else {
        // Too old for a live still to represent it: the clip (cut from the
        // recording at the event time) is the only accurate media.
        console.info("[events] Event too old for a live snapshot; stored without one");
      }

      /*
       * One shared decision point for DVR and AI events: rules, priority,
       * schedule, quiet hours, cooldown, duplicate protection, history and the
       * media-only Telegram queue. The DVR's own person/vehicle events are
       * stored but do not notify while detection source is AI only.
       */
      const { delivered } = processEventNotification({
        store,
        event: { ...event, priority, source: "hikvision", confidence: null },
        config,
        detectionSource,
        cameraName,
        snapshotPath: snapshot,
      });

      const stored = store.get(event.id);
      if (stored) {
        publishLiveEvent({
          notify: delivered,
          event: { ...stored, cameraName },
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
    // Stored timestamps carry the Asia/Kolkata offset, so a Kolkata-formatted
    // cutoff compares correctly and cannot delete "today" early.
    const cutoff = formatKolkataIso(new Date(Date.now() - days * 24 * 60 * 60 * 1000));
    /*
     * Snapshots and face crops belong to the event rows just deleted. This
     * removes files this hub wrote; it never touches DVR or MediaMTX
     * recordings. Face crops are cleaned in the same pass so detection cannot
     * leave orphaned files behind.
     */
    void runRetention({ store, dataDir: config.dataDir, cutoffIso: cutoff })
      .then((result) => {
        if (result.events > 0) console.info("[events] retention removed", result.events);
        if (result.notifications > 0) console.info("[events] retention removed notifications", result.notifications);
        if (result.orphanedSnapshots > 0) console.info("[events] retention removed orphan snapshots", result.orphanedSnapshots);
        if (result.crops > 0) console.info("[events] retention removed face crops", result.crops);
        if (result.orphanedCrops > 0) console.info("[events] retention removed orphan face crops", result.orphanedCrops);
        const record = (key: string, value: number | string): void => {
          try {
            store.setSetting(key, String(value));
          } catch {
            // A status write must never turn a successful cleanup into a failure.
          }
        };
        record("retention_last_run", new Date().toISOString());
        record("retention_last_error", "");
        record("retention_last_events", result.events);
        record("retention_last_notifications", result.notifications);
        record("retention_last_snapshots", result.snapshots);
        record("retention_last_orphaned_snapshots", result.orphanedSnapshots);
        record("retention_last_crops", result.crops);
        record("retention_last_orphaned_crops", result.orphanedCrops);
      })
      .catch((error) => {
        console.error("[events] retention", error instanceof Error ? error.name : "error");
        try {
          store.setSetting("retention_last_error", error instanceof Error ? error.name : "error");
        } catch {
          // The database itself may be the failure.
        }
      });
  } catch (error) {
    console.error("[events] retention", error instanceof Error ? error.name : "error");
  }
}
