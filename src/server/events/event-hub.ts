import "server-only";
import type { CctvEvent } from "@/lib/events";
import type { LiveFaceNotification } from "@/lib/faces";

export type LiveEvent = {
  notify: boolean;
  event: CctvEvent & { cameraName: string };
  /**
   * Present only for the temporary face-detection test notification. The
   * browser then shows a face notification instead of the event notification,
   * from the same stream.
   */
  face?: LiveFaceNotification;
};

type Listener = (payload: LiveEvent) => void;

const listeners = new Set<Listener>();

export function subscribeEvents(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function publishLiveEvent(payload: LiveEvent): void {
  for (const listener of listeners) {
    try {
      listener(payload);
    } catch (error) {
      console.error("[events] listener", error instanceof Error ? error.name : "error");
    }
  }
}
