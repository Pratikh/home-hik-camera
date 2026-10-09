import type { EventClassification, EventType } from "@/lib/events";

/**
 * Event priority. The DVR is the detector; this hub only ranks what the DVR
 * already reported. A notification rule may raise a priority floor through
 * `minimumPriority`, but nothing here invents detections.
 */
export const EVENT_PRIORITIES = ["LOW", "NORMAL", "HIGH", "CRITICAL"] as const;
export type EventPriority = (typeof EVENT_PRIORITIES)[number];

const RANK: Record<EventPriority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };

export function isEventPriority(value: string): value is EventPriority {
  return (EVENT_PRIORITIES as readonly string[]).includes(value);
}

export function priorityRank(priority: EventPriority): number {
  return RANK[priority];
}

export function atLeast(priority: EventPriority, floor: EventPriority | null): boolean {
  if (!floor) return true;
  return RANK[priority] >= RANK[floor];
}

export function maxPriority(left: EventPriority, right: EventPriority): EventPriority {
  return RANK[left] >= RANK[right] ? left : right;
}

/**
 * Default ranking for this DVR's actual alarm-log vocabulary.
 * This DS-7104HGHI-K1 writes motion only, with Human/Vehicle as a label on
 * that motion. The other types are ranked so that a DVR which does report
 * them is handled sensibly, not because this unit currently sends them.
 */
export function defaultPriority(type: EventType, classification: EventClassification | null): EventPriority {
  if (type === "intrusion") return "CRITICAL";
  if (type === "video_loss" || type === "storage_error") return "HIGH";
  if (type === "alarm" || type === "line_crossing") return "HIGH";
  if (classification === "person") return "HIGH";
  if (classification === "vehicle") return "NORMAL";
  return "NORMAL";
}

/** Events worth surfacing on the dashboard and under the "Important" filter. */
export function isImportant(priority: EventPriority): boolean {
  return RANK[priority] >= RANK.HIGH;
}

export function priorityLabel(priority: EventPriority): string {
  if (priority === "CRITICAL") return "Critical";
  if (priority === "HIGH") return "High";
  if (priority === "LOW") return "Low";
  return "Normal";
}