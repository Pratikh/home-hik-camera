import type { CctvEvent, EventClassification } from "@/lib/events";
import { eventOffsetMs, eventTitle } from "@/lib/events";
import type { EventPriority } from "@/lib/priority";

export type TimelineMarker = {
  id: string;
  offsetMs: number;
  label: string;
  classification: EventClassification | null;
  priority: EventPriority;
  cameraId: number;
  /** How many events this marker represents after grouping. */
  count: number;
  /** IDs of every event in the group, for seeking and detail links. */
  eventIds: string[];
};

/** Markers closer together than this collapse into one. */
export const MARKER_GROUP_MS = 2 * 60 * 1000;

/**
 * Grouping window for a given zoom, so a full-day view does not pack hundreds of
 * markers into a ~340px bar. Zooming in narrows the window and reveals detail.
 */
export function markerGroupMsForZoom(zoomHours: 24 | 6 | 1): number {
  if (zoomHours === 24) return 10 * 60 * 1000;
  if (zoomHours === 6) return 4 * 60 * 1000;
  return MARKER_GROUP_MS;
}

const RANK: Record<EventPriority, number> = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };

/**
 * Build timeline markers from real events.
 *
 * A day of continuous motion can produce hundreds of rows, which would make the
 * timeline unreadable. Nearby events are grouped into one marker that keeps the
 * strongest priority and a representative label, while the count records how
 * many events it stands for.
 */
export function buildTimelineMarkers(
  events: readonly CctvEvent[],
  dayStartMs: number,
  groupMs = MARKER_GROUP_MS,
): TimelineMarker[] {
  const placed = events
    .flatMap((event) => {
      const offsetMs = eventOffsetMs(dayStartMs, event.timestamp);
      return offsetMs === null ? [] : [{ event, offsetMs }];
    })
    .sort((left, right) => left.offsetMs - right.offsetMs);

  const markers: TimelineMarker[] = [];
  let groupStart: number | null = null;
  for (const item of placed) {
    const last = markers[markers.length - 1];
    // Compare against the group's first event, not the previous one, so a
    // steady stream does not chain into an ever-growing cluster.
    if (last && groupStart !== null && item.offsetMs - groupStart <= groupMs) {
      last.count += 1;
      last.eventIds.push(item.event.id);
      // Keep the earliest position, the strongest priority, and prefer a
      // classified label over plain motion for the group's tooltip.
      if (item.event.priority && RANK[item.event.priority] > RANK[last.priority]) {
        last.priority = item.event.priority;
      }
      if (!last.classification && item.event.classification) {
        last.classification = item.event.classification;
        last.label = eventTitle(item.event.type, item.event.classification);
      }
      continue;
    }
    groupStart = item.offsetMs;
    markers.push({
      id: item.event.id,
      offsetMs: item.offsetMs,
      label: eventTitle(item.event.type, item.event.classification),
      classification: item.event.classification,
      priority: item.event.priority,
      cameraId: item.event.cameraId,
      count: 1,
      eventIds: [item.event.id],
    });
  }
  return markers;
}

export function markerTitle(marker: TimelineMarker, clock: string): string {
  const parts = [marker.label, clock];
  if (marker.count > 1) parts.push(`${marker.count} events`);
  parts.push(marker.priority);
  return parts.join(" · ");
}