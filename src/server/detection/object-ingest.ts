import "server-only";
import { existsSync } from "node:fs";
import type { AppConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import { defaultPriority } from "@/lib/priority";
import { effectiveDetectionSource } from "@/lib/object-detection";
import { snapshotFile } from "@/lib/snapshot-path";
import { getCameraNameMap } from "@/server/cameras/names";
import { getDvrOverview } from "@/server/hikvision/hikvision-status";
import { objectDetectionConfig } from "@/server/detection/settings-store";
import { publishLiveEvent } from "@/server/events/event-hub";
import { processEventNotification } from "@/server/events/event-pipeline";
import { openEventStore, type EventStore, type NewEvent } from "@/server/events/event-store";

/**
 * Turn the object-detection worker's tracks into normal hub events.
 *
 * The worker writes one `object_detection_tracks` row per tracked object and the
 * exact analysed JPEG. This poller creates the event once, runs the existing
 * rule/notification pipeline, and then keeps the event's end time in sync while
 * the object is still visible. It never creates a second event for the same
 * track: the event id is deterministic and the track row carries it.
 *
 * AI detections are stamped with the server clock; the DVR indexes its
 * recordings with its own clock. The clip timestamp is therefore shifted by the
 * measured DVR offset so the event-time video covers the right seconds.
 */

export const OBJECT_INGEST_INTERVAL_MS = 2000;
const TRACKS_PER_CYCLE = 50;
const DVR_OFFSET_TTL_MS = 5 * 60 * 1000;

type OffsetCache = { offsetMs: number; checkedAt: number };
let offsetCache: OffsetCache = { offsetMs: 0, checkedAt: 0 };
let started = false;
let running = false;

function durationSeconds(firstSeen: string, lastSeen: string): number {
  const first = Date.parse(firstSeen);
  const last = Date.parse(lastSeen);
  if (!Number.isFinite(first) || !Number.isFinite(last)) return 0;
  return Math.max(0, Math.round(((last - first) / 1000) * 10) / 10);
}

function detectionMetadata(track: ReturnType<EventStore["objectTracksNeedingEvents"]>[number]): Record<string, unknown> {
  return {
    detection: {
      provider: "object-detection-worker",
      detector: track.detector,
      model: track.model,
      rawClass: track.rawClass,
      classification: track.classification,
      confidence: Math.round(track.confidence * 1000) / 1000,
      threshold: track.threshold,
      boundingBox: { x: track.x, y: track.y, width: track.width, height: track.height },
      trackId: track.trackId,
      firstSeen: track.firstSeen,
      lastSeen: track.lastSeen,
      detectionCount: track.detectionCount,
      durationSeconds: durationSeconds(track.firstSeen, track.lastSeen),
    },
  };
}

/** Merge the freshness fields into an already-created event. */
function progressMetadata(track: ReturnType<EventStore["objectTracksNeedingEvents"]>[number]): Record<string, unknown> {
  return {
    detection: {
      ...(detectionMetadata(track).detection as Record<string, unknown>),
      lastSeen: track.lastSeen,
      detectionCount: track.detectionCount,
      durationSeconds: durationSeconds(track.firstSeen, track.lastSeen),
    },
  };
}

/**
 * The DVR clock can run behind or ahead of the host. The recording search needs
 * DVR time, so the AI event's server timestamp is shifted by this offset.
 * Read at most every five minutes, and only when there is work to do.
 */
async function dvrOffsetMs(now: number): Promise<number> {
  if (now - offsetCache.checkedAt < DVR_OFFSET_TTL_MS) return offsetCache.offsetMs;
  try {
    const overview = await getDvrOverview();
    const deviceTime = overview.device?.currentDeviceTime ?? null;
    const parsed = deviceTime ? Date.parse(deviceTime) : Number.NaN;
    if (Number.isFinite(parsed)) {
      offsetCache = { offsetMs: parsed - now, checkedAt: now };
    } else {
      offsetCache = { offsetMs: 0, checkedAt: now };
    }
  } catch {
    offsetCache = { offsetMs: 0, checkedAt: now };
  }
  return offsetCache.offsetMs;
}

function clipTimestamp(firstSeen: string, offsetMs: number): string {
  const parsed = Date.parse(firstSeen);
  if (!Number.isFinite(parsed)) return firstSeen;
  const shifted = new Date(parsed + offsetMs);
  // Keep the same +05:30 wall-clock format the rest of the app stores.
  const ist = new Date(shifted.getTime() + 5.5 * 60 * 60 * 1000);
  return `${ist.toISOString().slice(0, 19)}+05:30`;
}

export type ObjectIngestResult = {
  created: number;
  updated: number;
  skipped: number;
};

/**
 * One ingestion pass. Exported for tests; production drives it from a timer.
 */
export async function ingestObjectTracks(input: {
  store: EventStore;
  config: AppConfig;
  now?: number;
  dvrOffsetOverrideMs?: number;
  /** Injected in tests so no DVR lookup happens. */
  cameraNames?: Record<number, string>;
}): Promise<ObjectIngestResult> {
  const { store, config } = input;
  const tracks = store.objectTracksNeedingEvents(TRACKS_PER_CYCLE);
  const result: ObjectIngestResult = { created: 0, updated: 0, skipped: 0 };
  if (tracks.length === 0) return result;

  // AI events exist only while detection is enabled. A track left behind by a
  // worker that was switched off (or crashed) must not turn into an AI event
  // after the Admin disabled the feature; DVR ingestion is unaffected.
  const detection = objectDetectionConfig(config.dataDir).settings;
  if (!detection.enabled) {
    result.skipped = tracks.length;
    return result;
  }

  const names = input.cameraNames ?? (await getCameraNameMap(config.dataDir));
  const detectionSource = effectiveDetectionSource(detection);
  const offset = input.dvrOffsetOverrideMs ?? (await dvrOffsetMs(input.now ?? Date.now()));

  for (const track of tracks) {
    const cameraName = names[track.cameraId] ?? `Camera ${track.cameraId}`;
    const priority = defaultPriority("motion", track.classification);

    if (track.existingEventId === null) {
      const event: NewEvent = {
        id: track.eventId,
        dedupeKey: `object|${track.cameraId}|${track.trackId}|${track.firstSeen}`,
        cameraId: track.cameraId,
        type: "motion",
        classification: track.classification,
        timestamp: track.firstSeen,
        endTimestamp: track.lastSeen,
        source: "object-detection-worker",
        metaId: `object:${track.trackId}`,
        priority,
        confidence: track.confidence,
        metadata: detectionMetadata(track),
      };
      const inserted = store.insertEvent(event);
      if (!inserted) {
        result.skipped += 1;
        continue;
      }

      // The snapshot is the exact frame the detector analysed. Only reference it
      // when the file really exists and stays inside DATA_DIR/events.
      const candidate = track.snapshotPath ? snapshotFile(config.dataDir, track.snapshotPath) : null;
      const storedSnapshot = candidate && existsSync(candidate) ? track.snapshotPath : null;
      if (storedSnapshot) store.setSnapshotPath(track.eventId, storedSnapshot);

      const { delivered } = processEventNotification({
        store,
        event: {
          id: track.eventId,
          cameraId: track.cameraId,
          type: "motion",
          classification: track.classification,
          timestamp: track.firstSeen,
          priority,
          source: "object-detection-worker",
          confidence: track.confidence,
        },
        config,
        detectionSource,
        cameraName,
        snapshotPath: storedSnapshot,
        clipTimestamp: clipTimestamp(track.firstSeen, offset),
      });

      const stored = store.get(track.eventId);
      if (stored) publishLiveEvent({ notify: delivered, event: { ...stored, cameraName } });
      result.created += 1;
      continue;
    }

    store.updateEventProgress(track.eventId, track.lastSeen, progressMetadata(track));
    result.updated += 1;
  }

  return result;
}

/** Start the ingestion timer once. Cheap and idle when there are no tracks. */
export function ensureObjectEventIngest(): void {
  if (started) return;
  started = true;
  const tick = (): void => {
    if (running) return;
    running = true;
    void (async () => {
      try {
        const config = getConfig();
        const result = await ingestObjectTracks({ store: openEventStore(config.dataDir), config });
        if (result.created > 0 || result.updated > 0) {
          console.info(
            `[object-ingest] created=${result.created} updated=${result.updated} skipped=${result.skipped}`,
          );
        }
      } catch (error) {
        console.error("[object-ingest]", error instanceof Error ? error.name : "error");
      } finally {
        running = false;
      }
    })();
  };
  tick();
  setInterval(tick, OBJECT_INGEST_INTERVAL_MS);
}
