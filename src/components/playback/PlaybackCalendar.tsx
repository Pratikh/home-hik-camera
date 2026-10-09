"use client";

import { useMemo } from "react";
import { DayPicker } from "react-day-picker";
import { isCalendarDate, todayInKolkata } from "@/lib/time-kolkata";

/** Parse a YYYY-MM-DD string as a local noon Date, avoiding UTC edge shifts. */
function toDate(value: string): Date | null {
  if (!isCalendarDate(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Render a Date back to YYYY-MM-DD using its local parts. */
export function toDateString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function PlaybackCalendar({
  month,
  selected,
  recorded,
  loading,
  onMonthChange,
  onSelect,
}: {
  /** YYYY-MM currently displayed. */
  month: string;
  /** YYYY-MM-DD currently selected, if any. */
  selected: string | null;
  /** YYYY-MM-DD dates that have at least one recording. */
  recorded: string[];
  loading: boolean;
  onMonthChange: (month: string) => void;
  onSelect: (date: string) => void;
}) {
  const today = todayInKolkata();

  /*
   * A date is selectable only when the DVR has a recording for it and it is not
   * in the future. Everything else is genuinely disabled, so the calendar cannot
   * send playback to a day with no recording.
   */
  const selectable = useMemo(() => new Set(recorded.filter((date) => date <= today)), [recorded, today]);
  const recordedDates = useMemo(() => recorded.map(toDate).filter((date): date is Date => date !== null), [recorded]);

  const monthDate = useMemo(() => toDate(`${month}-01`) ?? new Date(), [month]);
  const selectedDate = selected ? toDate(selected) : null;

  return (
    <div className="rounded-xl border border-line bg-card p-3">
      <div className="relative">
        {loading ? (
          <p className="absolute right-2 top-1 z-10 text-[11px] text-muted" role="status">
            Checking recordings...
          </p>
        ) : null}
        <DayPicker
          mode="single"
          month={monthDate}
          selected={selectedDate ?? undefined}
          onMonthChange={(next) => onMonthChange(`${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`)}
          onSelect={(next) => {
            if (!next) return;
            const value = toDateString(next);
            if (selectable.has(value)) onSelect(value);
          }}
          /* Future dates and dates with no recording are both unselectable. */
          disabled={[{ after: toDate(today) ?? new Date() }, (date) => !selectable.has(toDateString(date))]}
          modifiers={{ recorded: recordedDates }}
          modifiersClassNames={{ recorded: "rdp-recorded" }}
          showOutsideDays={false}
          weekStartsOn={1}
          classNames={{
            root: "rdp-app",
            months: "w-full",
            month: "w-full",
            month_caption: "flex h-10 items-center justify-center text-sm font-semibold",
            nav: "absolute inset-x-0 top-0 flex h-10 items-center justify-between",
            button_previous:
              "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:bg-white/5 hover:text-ink disabled:opacity-40",
            button_next:
              "inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:bg-white/5 hover:text-ink disabled:opacity-40",
            month_grid: "w-full border-collapse",
            weekdays: "text-[11px] uppercase tracking-wide text-muted",
            weekday: "h-8 w-8 text-center font-normal",
            week: "",
            day: "p-0.5 text-center align-middle",
            day_button:
              "relative inline-flex h-9 w-full max-w-9 items-center justify-center rounded-lg text-sm text-ink hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
            selected: "rdp-selected-app",
            today: "font-semibold text-teal",
            outside: "invisible",
            /* Keep the library class so the disabled styling below still applies. */
            disabled: "rdp-disabled text-muted/40",
            chevron: "h-4 w-4",
          }}
          components={{
            Chevron: ({ orientation }) => (
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                {orientation === "left" ? (
                  <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
                ) : (
                  <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                )}
              </svg>
            ),
          }}
          /*
            The accessible name carries the availability, so a screen-reader user
            is not relying on the dot marker alone.
          */
          labels={{
            labelDayButton: (date, modifiers) => {
              const label = date.toLocaleDateString("en-GB", {
                day: "numeric",
                month: "long",
                year: "numeric",
              });
              if (modifiers.recorded) return `${label} — recording available`;
              return `${label} — no recording`;
            },
            labelPrevious: () => "Previous month",
            labelNext: () => "Next month",
          }}
        />
      </div>

      {!loading && recorded.length === 0 ? (
        <p className="mt-1 text-center text-[11px] text-muted" role="status">
          No recordings available for this month.
        </p>
      ) : null}

      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line pt-2 text-[11px] text-muted">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-teal" aria-hidden="true" />
          Recording available
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-px w-3 bg-muted/60" aria-hidden="true" />
          No recording
        </li>
      </ul>
    </div>
  );
}
