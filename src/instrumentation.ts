export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") return;
  const { ensureEventProcessor } = await import("@/server/events/event-processor");
  ensureEventProcessor();
}
