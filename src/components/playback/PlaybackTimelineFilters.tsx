"use client";

import type { CctvEvent } from "@/lib/events";
import type { TimelineSegment } from "@/lib/timeline";

/**
 * Compact timeline filters.
 *
 * A category is offered only when the day actually contains it, so the chips can
 * never advertise a recording type or classification the DVR did not produce.
 * Filtering is presentation only: it hides tracks in the timeline and never
 * deletes, renames or re-fetches recordings.
 */
export type TimelineFilter = "all" | "recording" | "event" | "person" | "vehicle";

export function availableFilters(segments: TimelineSegment[], events: CctvEvent[]): TimelineFilter[] {
  const options: TimelineFilter[] = ["all"];
  if (segments.length > 0) options.push("recording");
  if (events.length > 0) options.push("event");
  if (events.some((event) => event.classification === "person")) options.push("person");
  if (events.some((event) => event.classification === "vehicle")) options.push("vehicle");
  return options;
}

const LABEL: Record<TimelineFilter, string> = {
  all: "All",
  recording: "Recording",
  event: "Event",
  person: "Person",
  vehicle: "Vehicle",
};

export function PlaybackTimelineFilters({
  value,
  onChange,
  segments,
  events,
}: {
  value: TimelineFilter;
  onChange: (next: TimelineFilter) => void;
  segments: TimelineSegment[];
  events: CctvEvent[];
}) {
  const options = availableFilters(segments, events);
  // Always render All + anything present; a filter that became invalid (a new
  // day with no vehicles) still shows its chip so the selection is explainable.
  if (!options.includes(value)) options.push(value);
  if (options.length <= 1) return null;

  return (
    <div
      /*
       * One line, never wrapped: a lone wrapping chip looked accidental and
       * pushed the timeline down on phones. Horizontal scrolling matches the
       * timeline's own gesture and keeps the height fixed at one chip.
       */
      className="flex snap-x items-center gap-1.5 overflow-x-auto pb-0.5 pe-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden [mask-image:linear-gradient(to_right,#000_calc(100%-28px),transparent)]"
      role="group"
      aria-label="Timeline filter"
      data-testid="timeline-filters"
    >
      {options.map((option) => {
        const active = option === value;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option)}
            className={`flex h-9 shrink-0 snap-start items-center gap-1.5 rounded-full border px-3 text-xs font-medium ${
              active
                ? "border-teal bg-teal/15 text-teal"
                : "border-line bg-card text-muted hover:text-ink"
            }`}
          >
            {swatch(option)}
            {LABEL[option]}
          </button>
        );
      })}
    </div>
  );
}

function swatch(option: TimelineFilter) {
  if (option === "recording") return <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-online" />;
  if (option === "event") return <span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-warn" />;
  if (option === "person") return <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-teal" />;
  if (option === "vehicle") return <span aria-hidden="true" className="h-2.5 w-2.5 rounded-full bg-info" />;
  return null;
}
