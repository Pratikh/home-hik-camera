"use client";

import { FormEvent, useState } from "react";
import type { CameraView } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { DatePickerField } from "@/components/playback/DatePickerField";

/**
 * Camera / date / time-range selection for playback.
 *
 * ONE set of controls, laid out by CSS so the DOM never contains duplicates
 * (duplicate date pickers would give screen readers two "Date" buttons and make
 * every end-to-end locator ambiguous):
 *
 * - Desktop (`lg:`): a single horizontal row so it costs little vertical space
 *   and keeps the player and timeline above the fold.
 * - Mobile / tablet: the same fields stacked, with the date in a compact
 *   previous-day / date / next-day navigator and the time range behind a
 *   disclosure so the common case (open today, scrub) is one tap away.
 *
 * Date and time changes both go through the existing recording search; nothing
 * here decides what to fetch.
 */
export function PlaybackFilters({
  cameras,
  camera,
  date,
  startTime,
  endTime,
  pending,
  month,
  recorded,
  availabilityStatus,
  availabilityError,
  onCamera,
  onStartTime,
  onEndTime,
  onSearch,
  onMonthChange,
  onDate,
  onReloadAvailability,
  onStepDay,
}: {
  cameras: CameraView[];
  camera: number;
  date: string;
  startTime: string;
  endTime: string;
  pending: boolean;
  /** Month shown by the date popover. */
  month: string;
  /** Dates with a recording, from the DVR. */
  recorded: string[];
  availabilityStatus: "idle" | "loading" | "ready" | "error";
  availabilityError: string | null;
  onCamera: (id: number) => void;
  onStartTime: (value: string) => void;
  onEndTime: (value: string) => void;
  onSearch: () => void;
  onMonthChange: (month: string) => void;
  onDate: (date: string) => void;
  onReloadAvailability: () => void;
  /** Move the selected day by -1 or +1 (mobile date navigator). */
  onStepDay: (deltaDays: number) => void;
}) {
  // Time range is collapsed on phones and always visible on desktop.
  const [timeOpen, setTimeOpen] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch();
  }

  const field = "h-11 w-full rounded-lg border border-line bg-card px-3 text-sm";
  const label = "mb-1 block text-xs font-medium uppercase tracking-wide text-muted";

  const cameraSelect = (
    <label className="min-w-0 text-sm lg:flex-[1.3]">
      <span className={label}>Camera</span>
      <select
        value={camera}
        onChange={(event) => onCamera(Number(event.target.value))}
        className={field}
        aria-label="Camera"
      >
        {cameras.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
    </label>
  );

  const dateField = (
    <div className="min-w-0 lg:flex-1">
      <DatePickerField
        date={date}
        month={month}
        recorded={recorded}
        status={availabilityStatus}
        error={availabilityError}
        onMonthChange={onMonthChange}
        onSelect={onDate}
        onReload={onReloadAvailability}
      />
    </div>
  );

  const fromField = (
    <label className="text-sm lg:w-32">
      <span className={label}>From</span>
      <input
        type="time"
        value={startTime}
        onChange={(event) => onStartTime(event.target.value)}
        className={field}
        aria-label="Start time"
        required
      />
    </label>
  );

  const toField = (
    <label className="text-sm lg:w-32">
      <span className={label}>To</span>
      <input
        type="time"
        value={endTime}
        onChange={(event) => onEndTime(event.target.value)}
        className={field}
        aria-label="End time"
        required
      />
    </label>
  );

  return (
    <form onSubmit={submit} className="grid gap-2" aria-label="Recording search">
      {/*
        Every control is rendered exactly once. The container is a grid that
        stacks on small screens and becomes one row at `lg`; the day-step
        buttons are hidden above `lg`, and the disclosure wrapper is flattened
        there so its children join the desktop row.
      */}
      <div className="grid gap-2 lg:flex lg:items-end lg:gap-2">
        {cameraSelect}
        {/*
          Mobile date navigator: one row, "‹ [date] ›", so the arrows visibly
          flank the value they change. On desktop the arrows are hidden and the
          date joins the single control row (lg:contents).
        */}
        <div className="flex min-w-0 items-end gap-2 lg:contents">
          <div className="min-w-0 flex-1">{dateField}</div>
          <DayStepButton direction="previous" onClick={() => onStepDay(-1)} className="lg:hidden" />
          <DayStepButton direction="next" onClick={() => onStepDay(1)} className="lg:hidden" />
        </div>
        {/*
          One pair of time inputs, shown in two places by state rather than by
          duplicating markup: a collapsible panel on phones/tablets, and always
          inline in the desktop row. `<details>` is deliberately avoided for the
          desktop path — it keeps its own box, so `lg:contents` would swallow the
          fields into a zero-height element (which is exactly what happened).
        */}
        <div className="grid gap-2 lg:contents">
          <button
            type="button"
            onClick={() => setTimeOpen((value) => !value)}
            aria-expanded={timeOpen}
            className="flex h-10 w-full items-center justify-between rounded-lg border border-line bg-card/60 px-3 text-xs font-medium uppercase tracking-wide text-muted lg:hidden"
          >
            <span>
              Time range <span className="normal-case text-ink-2">{startTime} – {endTime}</span>
            </span>
            <ChevronIcon open={timeOpen} />
          </button>
          {/*
            ONE container, ONE pair of inputs. A plain div honours `display:
            contents`, so on desktop the fields join the row directly; on mobile
            it is a two-column panel that the toggle above reveals.
          */}
          <div
            className={`gap-2 ${timeOpen ? "grid grid-cols-2" : "hidden"} lg:contents`}
          >
            {fromField}
            {toField}
          </div>
          <SearchButton />
        </div>
      </div>
    </form>
  );

  function SearchButton() {
    return (
      <button
        type="submit"
        disabled={pending}
        className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f] hover:brightness-110 disabled:opacity-60 lg:w-auto lg:shrink-0"
        aria-label="Search recordings"
      >
        <span className="lg:hidden">{pending ? "…" : "Search recordings"}</span>
        <span className="hidden lg:inline">{pending ? Messages.searchingRecordings : "Search recordings"}</span>
      </button>
    );
  }
}

function DayStepButton({
  direction,
  onClick,
  className = "",
}: {
  direction: "previous" | "next";
  onClick: () => void;
  className?: string;
}) {
  const previous = direction === "previous";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={previous ? "Previous day" : "Next day"}
      className={`grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line bg-card text-ink-2 hover:bg-white/5 active:bg-white/10 ${className}`}
    >
      <svg viewBox="0 0 24 24" className={`h-5 w-5 ${previous ? "" : "rotate-180"}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m15 18-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
