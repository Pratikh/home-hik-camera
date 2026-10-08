import "server-only";
import type { CctvEvent } from "@/lib/events";

export type LiveEvent = {
  notify: boolean;
  event: CctvEvent & { cameraName: string };
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
