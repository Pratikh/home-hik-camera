export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { ensureEventProcessor } = await import("@/server/events/event-processor");
  ensureEventProcessor();
  // Temporary face-notification test mode. It only starts a timer when
  // FACE_DETECTION_TEST_NOTIFICATIONS is true, and it never touches the event
  // processor's own notifications.
  const { ensureFaceTestNotifier } = await import("@/server/events/face-notify");
  ensureFaceTestNotifier();
  // Background Telegram media (face crop + event clip). Queueing is instant; the
  // DVR search and FFmpeg run here, never on the event path.
  const { ensureTelegramMediaWorker } = await import("@/server/notifications/telegram-media");
  ensureTelegramMediaWorker();

  // Live object detection: turn the worker's tracked objects into normal events
  // and run the shared rule/notification pipeline. Idle when no tracks exist.
  const { ensureObjectEventIngest } = await import("@/server/detection/object-ingest");
  ensureObjectEventIngest();

  // Expired sessions are dead rows, not usable credentials. Prune once at
  // startup and then hourly; active sessions are never touched.
  const { getConfig } = await import("@/lib/config");
  const { accountStore } = await import("@/server/auth/accounts");
  const { ensureThumbnailWorker } = await import("@/server/playback/thumbnail-worker");
  const { pruneExpired } = await import("@/server/playback/thumbnail-store");
  ensureThumbnailWorker();
  const prune = (): void => {
    try {
      accountStore(getConfig().dataDir).pruneExpiredSessions();
    } catch (error) {
      console.error("[auth] session prune", error instanceof Error ? error.name : "error");
    }
  };
  prune();
  const timer = setInterval(prune, 60 * 60 * 1000);
  // Thumbnail sprites are generated cache with their own retention window.
  // Prune even when nobody opens the timeline, so an idle install cannot grow
  // its cache forever.
  const pruneThumbnails = (): void => {
    void pruneExpired()
      .then((removed) => {
        if (removed > 0) console.info("[thumbnail] retention removed", removed, "day(s)");
      })
      .catch((error) => console.error("[thumbnail] retention", error instanceof Error ? error.name : "error"));
  };
  pruneThumbnails();
  const thumbnailTimer = setInterval(pruneThumbnails, 6 * 60 * 60 * 1000);
  // Never keep the process alive only for maintenance.
  timer.unref?.();
  thumbnailTimer.unref?.();
}
