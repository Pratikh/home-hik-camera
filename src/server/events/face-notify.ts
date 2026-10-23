import "server-only";
import type { AppConfig } from "@/lib/config";
import { getConfig } from "@/lib/config";
import {
  FACE_TEST_RULE_ID,
  FACE_TEST_RULE_NAME,
  faceTestWindowState,
  type FaceTestWindowReason,
} from "@/lib/faces";
import { getCameraNameMap } from "@/server/cameras/names";
import { publishLiveEvent, type LiveEvent } from "@/server/events/event-hub";
import { openEventStore, type EventStore, type FaceTestCandidate } from "@/server/events/event-store";
import { enqueueFaceMedia, type FaceMediaJob } from "@/server/notifications/telegram-media";

/**
 * Temporary browser notification for detected faces.
 *
 * This is a TEST MODE for a bounded window. It does not replace, reorder or
 * change anything about the existing motion/person event notifications: it adds
 * one extra, clearly-labelled decision per event, recorded in the same
 * `notification_history` table with its own rule id and delivered over the same
 * server-sent event stream the browser already listens to.
 *
 * It never identifies anyone. A notification says "Face detected", never a name.
 *
 * Design notes:
 * - The hub decides, not the detector. The worker stays detection-only, and the
 *   browser delivery channel lives here.
 * - Cooldown is per camera and derived from the notification history itself
 *   (`status = 'sent'` for this rule and camera), so it survives a restart of
 *   either process without any extra state.
 * - A (finished_at, event_id) cursor in `app_settings` means only detections
 *   that complete *after* the mode becomes active are considered, and a restart
 *   resumes exactly where it stopped.
 * - `notification_history` has UNIQUE(event_id, rule_id), so even a repeated
 *   pass cannot record — or send — the same event twice.
 */

/** How often the hub looks for newly completed face jobs. */
export const FACE_TEST_POLL_INTERVAL_MS = 5000;
/** Bounded work per tick, so a backlog cannot stall the hub. */
export const FACE_TEST_MAX_PER_CYCLE = 25;

const CURSOR_AT_KEY = "face_test_notify_cursor_at";
const CURSOR_ID_KEY = "face_test_notify_cursor_id";
const WINDOW_KEY = "face_test_notify_window";

/** Informational only: a detected face has no DVR-assigned severity. */
const FACE_TEST_PRIORITY = "NORMAL" as const;

export type FaceTestDecision = {
  eventId: string;
  cameraId: number;
  cameraName: string;
  faces: number;
  maxConfidence: number;
  status: "sent" | "suppressed";
  reason: "SENT" | "COOLDOWN";
  /**
   * Whether the background media job (face crop / clip) was queued. Telegram
   * receives media only; the clip is generated later by the media worker, never
   * here.
   */
  media: "queued" | "disabled" | "full" | "skipped";
};

export type FaceTestRun = {
  active: boolean;
  reason: FaceTestWindowReason;
  evaluated: number;
  sent: number;
  suppressed: number;
  decisions: FaceTestDecision[];
};

export type FaceTestRunInput = {
  store: EventStore;
  config: Pick<
    AppConfig,
    "faceDetectionTestNotifications" | "faceDetectionTestUntil" | "faceDetectionTestNotificationCooldownSeconds"
  >;
  /** Needed to resolve camera display names. */
  dataDir: string;
  now?: Date;
  /** Injected in tests; defaults to the real server-sent event hub. */
  publish?: (payload: LiveEvent) => void;
  /**
   * Injected in tests; defaults to queueing the background media job. Telegram
   * shares the existing cooldown, expiry and duplicate protection: only an
   * accepted decision queues media.
   */
  enqueueMedia?: (job: FaceMediaJob) => "queued" | "disabled" | "full";
  /** Injected in tests so no DVR lookup happens. */
  cameraNames?: Record<number, string>;
  /** Injected in tests to capture the structured log lines. */
  log?: (line: string) => void;
};

function logLine(message: string): void {
  console.info(`[face-test-notify] ${message}`);
}

/**
 * Decide and deliver test notifications for face jobs completed since the last
 * pass. Never throws: a failure here must not affect event handling.
 */
export async function runFaceTestNotifications(input: FaceTestRunInput): Promise<FaceTestRun> {
  const now = input.now ?? new Date();
  const store = input.store;
  const logger = input.log ?? logLine;
  const until = input.config.faceDetectionTestUntil;
  const cooldownSeconds = input.config.faceDetectionTestNotificationCooldownSeconds;

  const window = faceTestWindowState({
    enabled: input.config.faceDetectionTestNotifications,
    until,
    now,
  });

  if (!window.active) {
    /*
     * Park the cursor while the mode is off, so switching it back on starts from
     * "now" instead of replaying every detection that happened in between.
     */
    if (store.setting(WINDOW_KEY)) store.setSetting(WINDOW_KEY, "");
    return { active: false, reason: window.reason, evaluated: 0, sent: 0, suppressed: 0, decisions: [] };
  }

  // A new (or re-activated) window starts from the newest completed job.
  if (store.setting(WINDOW_KEY) !== (until ?? "")) {
    const latest = store.latestFaceTestCursor();
    store.setSetting(CURSOR_AT_KEY, latest?.finishedAt ?? "");
    store.setSetting(CURSOR_ID_KEY, latest?.eventId ?? "");
    store.setSetting(WINDOW_KEY, until ?? "");
  }

  const cursorAt = store.setting(CURSOR_AT_KEY) || null;
  const cursorId = store.setting(CURSOR_ID_KEY) || null;
  const candidates = store.faceTestCandidates({
    ruleId: FACE_TEST_RULE_ID,
    cursorAt,
    cursorId,
    limit: FACE_TEST_MAX_PER_CYCLE,
  });

  if (candidates.length === 0) {
    return { active: true, reason: "ACTIVE", evaluated: 0, sent: 0, suppressed: 0, decisions: [] };
  }

  const cameraNames = input.cameraNames ?? (await getCameraNameMap(input.dataDir));
  const publish = input.publish ?? publishLiveEvent;
  const enqueueMedia = input.enqueueMedia ?? ((job: FaceMediaJob) => enqueueFaceMedia(job));
  const decisions: FaceTestDecision[] = [];

  for (const candidate of candidates) {
    const cameraId = candidate.cameraId;
    const cameraName = cameraNames[cameraId] ?? `Camera ${cameraId}`;
    // Per-camera cooldown, measured between detections (see lastSentFaceTestAt).
    const anchor = store.lastSentFaceTestAt(FACE_TEST_RULE_ID, cameraId);
    const onCooldown =
      anchor !== null &&
      Date.parse(candidate.finishedAt) - Date.parse(anchor) < cooldownSeconds * 1000;

    const recorded = store.recordNotification({
      eventId: candidate.eventId,
      ruleId: FACE_TEST_RULE_ID,
      ruleName: FACE_TEST_RULE_NAME,
      cameraId,
      priority: FACE_TEST_PRIORITY,
      status: onCooldown ? "suppressed" : "sent",
      reason: onCooldown ? "Cooldown active for this camera" : null,
      eventTimestamp: candidate.eventTimestamp,
    });

    if (!recorded) {
      // Already decided for this event (a repeated pass, a restart, a retry).
      continue;
    }

    if (onCooldown) {
      decisions.push(decision(candidate, cameraName, "suppressed", "COOLDOWN", "skipped"));
      logger(
        `event=${candidate.eventId} camera=${cameraId} camera_name="${cameraName}" faces=${candidate.faces} ` +
          `max_confidence=${candidate.maxConfidence.toFixed(2)} result=SUPPRESSED reason=COOLDOWN`,
      );
      continue;
    }

    const event = store.get(candidate.eventId);
    if (!event) continue;

    publish({
      notify: true,
      event: { ...event, cameraName },
      face: {
        eventId: candidate.eventId,
        cameraId,
        cameraName,
        faces: candidate.faces,
        maxConfidence: candidate.maxConfidence,
      },
    });

    /*
     * Telegram receives media only for an accepted face notification. The worker
     * prefers the clip, then the stored face crop, then the event snapshot. The
     * old text message is never sent. Queueing is instant; the DVR search and
     * FFmpeg run in the media worker, so nothing here waits for them.
     */
    let media: FaceTestDecision["media"] = "skipped";
    try {
      media = enqueueMedia({
        eventId: candidate.eventId,
        cameraId,
        cameraName,
        faces: candidate.faces,
        maxConfidence: candidate.maxConfidence,
        eventTimestamp: candidate.eventTimestamp,
        snapshotPath: store.snapshotPath(candidate.eventId),
      });
    } catch (error) {
      console.error("[telegram-media] enqueue", error instanceof Error ? error.name : "error");
      media = "skipped";
    }

    decisions.push(decision(candidate, cameraName, "sent", "SENT", media));
    logger(
      `event=${candidate.eventId} camera=${cameraId} camera_name="${cameraName}" faces=${candidate.faces} ` +
        `max_confidence=${candidate.maxConfidence.toFixed(2)} result=SENT media=${media}`,
    );
  }

  // Advance past everything examined, so the next pass starts after this batch.
  const last = candidates[candidates.length - 1]!;
  store.setSetting(CURSOR_AT_KEY, last.finishedAt);
  store.setSetting(CURSOR_ID_KEY, last.eventId);

  return {
    active: true,
    reason: "ACTIVE",
    evaluated: candidates.length,
    sent: decisions.filter((item) => item.status === "sent").length,
    suppressed: decisions.filter((item) => item.status === "suppressed").length,
    decisions,
  };
}

function decision(
  candidate: FaceTestCandidate,
  cameraName: string,
  status: "sent" | "suppressed",
  reason: "SENT" | "COOLDOWN",
  media: FaceTestDecision["media"],
): FaceTestDecision {
  return {
    eventId: candidate.eventId,
    cameraId: candidate.cameraId,
    cameraName,
    faces: candidate.faces,
    maxConfidence: candidate.maxConfidence,
    status,
    reason,
    media,
  };
}

/** A one-line, human-readable explanation for an inactive window. */
export function faceTestWindowWarning(reason: FaceTestWindowReason): string | null {
  if (reason === "ACTIVE") return null;
  if (reason === "DISABLED") return null;
  if (reason === "MISSING_UNTIL") {
    return "FACE_DETECTION_TEST_NOTIFICATIONS is true but FACE_DETECTION_TEST_UNTIL is empty; test notifications stay OFF. Set an ISO-8601 timestamp with a timezone offset, for example 2026-10-12T10:00:00+05:30.";
  }
  if (reason === "INVALID_UNTIL") {
    return "FACE_DETECTION_TEST_UNTIL is not a valid ISO-8601 date-time with a timezone offset; test notifications stay OFF. Expected format: 2026-10-12T10:00:00+05:30 (or ...Z).";
  }
  return "FACE_DETECTION_TEST_UNTIL is in the past; test notifications are OFF. Face detection itself keeps running. Update the expiry and restart the hub to start a new window.";
}

let started = false;
let stateLogged: string | null = null;

/** Start the poller once. A no-op when the test mode is not configured. */
export function ensureFaceTestNotifier(): void {
  if (started) return;
  started = true;

  const config = getConfig();
  if (!config.faceDetectionTestNotifications) {
    console.info("[face-test-notify] result=DISABLED reason=NOT_ENABLED");
    return;
  }

  const window = faceTestWindowState({ enabled: true, until: config.faceDetectionTestUntil });
  const warning = faceTestWindowWarning(window.reason);
  if (warning) console.warn(`[face-test-notify] ${warning}`);

  console.info(
    `[face-test-notify] result=${window.active ? "ACTIVE" : "DISABLED"} reason=${window.reason} ` +
      `until=${window.until ?? "(unset)"} cooldown_seconds=${config.faceDetectionTestNotificationCooldownSeconds}`,
  );

  setInterval(() => void faceTestTick(), FACE_TEST_POLL_INTERVAL_MS);
}

async function faceTestTick(): Promise<void> {
  try {
    const config = getConfig();
    if (!config.faceDetectionTestNotifications) return;
    const store = openEventStore(config.dataDir);
    const run = await runFaceTestNotifications({
      store,
      config,
      dataDir: config.dataDir,
    });
    const state = `${run.active}:${run.reason}`;
    if (stateLogged !== state) {
      stateLogged = state;
      if (!run.active && run.reason !== "DISABLED") {
        console.warn(`[face-test-notify] result=DISABLED reason=${run.reason}`);
      }
    }
  } catch (error) {
    console.error("[face-test-notify] tick", error instanceof Error ? error.name : "error");
  }
}
