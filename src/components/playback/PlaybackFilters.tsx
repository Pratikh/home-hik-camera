"use client";

import { FormEvent } from "react";
import type { CameraView } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { DatePickerField } from "@/components/playback/DatePickerField";

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
}) {
  function submit(event: FormEvent) {
    event.preventDefault();
    onSearch();
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_auto_auto]">
      <label className="block text-sm">
        <span className="mb-1 block text-muted">Camera</span>
        <select
          value={camera}
          onChange={(event) => onCamera(Number(event.target.value))}
          className="h-11 w-full rounded-lg border border-line bg-card px-3"
          aria-label="Camera"
        >
          {cameras.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </label>
      {/* The popover is anchored here and takes no layout space until opened. */}
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
      <label className="block text-sm">
        <span className="mb-1 block text-muted">From</span>
        <input
          type="time"
          value={startTime}
          onChange={(event) => onStartTime(event.target.value)}
          className="h-11 w-full rounded-lg border border-line bg-card px-3"
          aria-label="Start time"
          required
        />
      </label>
      <label className="block text-sm">
        <span className="mb-1 block text-muted">To</span>
        <input
          type="time"
          value={endTime}
          onChange={(event) => onEndTime(event.target.value)}
          className="h-11 w-full rounded-lg border border-line bg-card px-3"
          aria-label="End time"
          required
        />
      </label>
      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending}
          className="h-11 w-full rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f] disabled:opacity-60 xl:w-auto"
        >
          {pending ? Messages.searchingRecordings : "Search recordings"}
        </button>
      </div>
    </form>
  );
}
