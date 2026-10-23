import "server-only";
import type { AppConfig } from "@/lib/config";
import type { EventClassification, EventType } from "@/lib/events";
import { formatKolkataIso } from "@/lib/time-kolkata";
import type { EventPriority } from "@/lib/priority";
import type { DetectionSource } from "@/lib/object-detection";
import { enqueueEventMedia } from "@/server/notifications/telegram-media";
import { cooldownBlocks, cooldownWindowStart, evaluateRules } from "@/server/events/rule-engine";
import { recordNotificationDecisions } from "@/server/events/notification-decisions";
import type { EventStore } from "@/server/events/event-store";

/**
 * The single decision point shared by the DVR poller and the AI event ingester.
 *
 * Rule matching, priority, schedule, quiet hours, cooldown, duplicate
 * protection, notification history and Telegram media queueing all live here so
 * the two event sources cannot drift apart.
 */

export type PipelineEvent = {
  id: string;
  cameraId: number;
  type: EventType;
  classification: EventClassification | null;
  timestamp: string;
  priority: EventPriority;
  source: string;
  /** Detector confidence for the media caption; null when the source has none. */
  confidence?: number | null;
};

/**
 * Which source may raise person/vehicle notifications.
 *
 * Classification-less DVR motion is not a person/vehicle decision, so it keeps
 * its historical behaviour in every mode. Only labelled person/vehicle events
 * are subject to the AI / DVR choice.
 */
export function notificationSourceAllowed(
  source: string,
  classification: EventClassification | null,
  mode: DetectionSource,
): boolean {
  if (classification === null) return true;
  const fromAi = source === "object-detection-worker";
  if (mode === "ai_only") return fromAi;
  if (mode === "dvr_only") return !fromAi;
  return true;
}

export type PipelineInput = {
  store: EventStore;
  event: PipelineEvent;
  config: AppConfig;
  /** The Admin's current detection source (SQLite), not an env value. */
  detectionSource: DetectionSource;
  cameraName: string;
  /**
   * The event's own stored snapshot. `undefined` means "do not queue an image"
   * (the caller had no still); `null` means the event genuinely has none and the
   * media worker should try the clip only.
   */
  snapshotPath?: string | null;
  /**
   * Timestamp used for the recording clip search. For AI events this is shifted
   * by the measured DVR clock offset, because the DVR indexes recordings by its
   * own clock while an AI detection is stamped with the server clock.
   */
  clipTimestamp?: string;
};

export function processEventNotification(input: PipelineInput): { delivered: boolean } {
  const { store, event, config } = input;
  const mode = input.detectionSource;

  if (!notificationSourceAllowed(event.source, event.classification, mode)) {
    // Stored and searchable, but this source may not notify in this mode.
    return { delivered: false };
  }

  const rules = store.rules();
  const at = new Date(event.timestamp);
  const evaluation = evaluateRules(rules, event, at, {
    cooldownActive: (rule) =>
      cooldownBlocks(rule, store.countSentSince(rule.id, formatKolkataIso(cooldownWindowStart(rule, at)))),
  });

  const { delivered, deliveredRuleNames } = recordNotificationDecisions({
    store,
    event,
    evaluation,
    priority: event.priority,
  });

  if (delivered) {
    enqueueEventMedia(
      {
        eventId: event.id,
        cameraId: event.cameraId,
        cameraName: input.cameraName,
        faces: 0,
        maxConfidence: 0,
        eventTimestamp: event.timestamp,
        clipTimestamp: input.clipTimestamp ?? null,
        classification: event.classification,
        confidence: event.confidence ?? null,
        snapshotPath: input.snapshotPath === undefined ? null : input.snapshotPath,
      },
      config,
    );
    // `deliveredRuleNames` is kept in the return type for diagnostics; the
    // notification path itself is media only, so no text is rendered here.
    void deliveredRuleNames;
  }

  return { delivered };
}
