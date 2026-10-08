"use client";

import type { RecordingView } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { formatKolkataHourMinute } from "@/lib/time-kolkata";

function tone(type: RecordingView["type"]): string {
  if (type === "continuous") return "text-online";
  if (type === "motion") return "text-warn";
  if (type === "alarm") return "text-offline";
  return "text-muted";
}

export function RecordingList({
  recordings,
  selectedId,
  pending,
  emptyMessage,
  onSelect,
}: {
  recordings: RecordingView[];
  selectedId: string | null;
  pending: boolean;
  emptyMessage: string | null;
  onSelect: (recording: RecordingView) => void;
}) {
  return (
    <section className="min-w-0 rounded-xl border border-line bg-card p-3" aria-label="Recordings">
      <h2 className="text-sm font-semibold">Recordings</h2>
      {pending ? <p className="mt-3 text-sm text-muted">{Messages.searchingRecordings}</p> : null}
      {!pending && emptyMessage ? <p className="mt-3 text-sm text-muted">{emptyMessage}</p> : null}
      <ul className="mt-3 flex max-h-[28rem] flex-col gap-2 overflow-auto">
        {recordings.map((recording) => {
          const start = formatKolkataHourMinute(new Date(recording.startTime));
          const end = formatKolkataHourMinute(new Date(recording.endTime));
          const selected = recording.id === selectedId;
          return (
            <li key={recording.id}>
              <button
                type="button"
                aria-pressed={selected}
                onClick={() => onSelect(recording)}
                className={`flex w-full items-center justify-between gap-3 rounded-lg border px-3 py-3 text-left text-sm ${selected ? "border-teal bg-white/5" : "border-line hover:bg-white/5"}`}
              >
                <span className="font-mono tabular-nums">
                  {start} – {end}
                </span>
                <span className={tone(recording.type)}>{recording.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
