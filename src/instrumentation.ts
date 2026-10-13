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
}
