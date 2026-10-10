export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { ensureEventProcessor } = await import("@/server/events/event-processor");
  ensureEventProcessor();
  // Temporary face-notification test mode. It only starts a timer when
  // FACE_DETECTION_TEST_NOTIFICATIONS is true, and it never touches the event
  // processor's own notifications.
  const { ensureFaceTestNotifier } = await import("@/server/events/face-notify");
  ensureFaceTestNotifier();
}
