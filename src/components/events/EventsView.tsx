"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CamerasResponse } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client-api";
import {
  eventDurationSeconds,
  eventLabel,
  eventPlaybackHref,
  eventTitle,
  type CctvEvent,
  type EventClassification,
  type EventType,
} from "@/lib/events";
import { Messages } from "@/lib/messages";
import { formatKolkataClock, todayInKolkata } from "@/lib/time-kolkata";
import { PageIntro } from "@/components/ui/States";

type EventList = { events: CctvEvent[]; total: number; page: number; pageSize: number };

function dot(classification: EventClassification | null, type: EventType): string {
  if (classification === "person" || type === "alarm") return "bg-offline";
  if (classification === "vehicle") return "bg-warn";
  return "bg-teal";
}

export function EventsView({ initialDate }: { initialDate: string }) {
  const params = useSearchParams();
  const [cameras, setCameras] = useState<Record<number, string>>({});
  const [camera, setCamera] = useState("all");
  const [type, setType] = useState("all");
  const [classification, setClassification] = useState("all");
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<EventList | null>(null);
  const [selected, setSelected] = useState<CctvEvent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void api<CamerasResponse>("/api/cameras")
      .then((body) => {
        const names: Record<number, string> = {};
        for (const item of body.cameras) names[item.id] = item.name;
        setCameras(names);
      })
      .catch(() => undefined);
  }, []);

  async function search(nextPage = 1, overrides?: { date?: string; camera?: string }) {
    setLoading(true);
    setError(null);
    const queryDate = overrides?.date ?? date;
    const queryCamera = overrides?.camera ?? camera;
    const searchParams = new URLSearchParams({
      camera: queryCamera,
      type,
      classification,
      date: queryDate,
      startTime,
      endTime,
      page: String(nextPage),
      pageSize: "20",
    });
    try {
      const body = await api<EventList>(`/api/events?${searchParams.toString()}`);
      setResult(body);
      setPage(nextPage);
      const focus = params.get("focus");
      const focused = body.events.find((event) => event.id === focus) ?? null;
      setSelected((current) => focused ?? current ?? body.events[0] ?? null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void search(1), 0);
    const onEvent = () => {
      if (date === todayInKolkata() && camera === "all" && type === "all" && classification === "all") void search(1);
    };
    window.addEventListener("cctv-event", onEvent);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("cctv-event", onEvent);
    };
    // The first search uses the initial filters. Later filter changes use the Search button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const name = (id: number) => cameras[id] ?? `Camera ${id}`;

  return (
    <div className="min-w-0">
      <PageIntro title="Events" detail="Motion events from the DVR, including person and vehicle labels when the DVR sends them." />
      <form
        className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-6"
        onSubmit={(event) => {
          event.preventDefault();
          void search(1);
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block text-muted">Camera</span>
          <select value={camera} onChange={(event) => setCamera(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Camera">
            <option value="all">All cameras</option>
            {[1, 2, 3, 4].map((id) => <option key={id} value={id}>{name(id)}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Type</span>
          <select value={type} onChange={(event) => setType(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Event type">
            <option value="all">All</option>
            <option value="motion">Motion</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Classification</span>
          <select value={classification} onChange={(event) => setClassification(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Classification">
            <option value="all">All</option>
            <option value="person">Person</option>
            <option value="vehicle">Vehicle</option>
            <option value="none">Unclassified</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Date" required />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">From</span>
          <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Start time" />
        </label>
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-sm">
            <span className="mb-1 block text-muted">To</span>
            <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="End time" />
          </label>
        </div>
        <button type="submit" className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f] xl:col-span-6 xl:w-fit">
          {loading ? "Searching..." : "Search"}
        </button>
      </form>
      {error ? <p className="mb-3 text-sm text-warn" role="alert">{error}</p> : null}
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0" aria-label="Event list">
          <h2 className="mb-2 text-sm font-semibold">{date === todayInKolkata() ? "Today" : date}</h2>
          {!loading && result && result.events.length === 0 ? <p className="text-sm text-muted">No events for this period.</p> : null}
          <ul className="flex flex-col gap-2">
            {result?.events.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => setSelected(event)}
                  aria-pressed={selected?.id === event.id}
                  className={`flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left ${selected?.id === event.id ? "border-teal bg-white/5" : "border-line bg-card"}`}
                >
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot(event.classification, event.type)}`} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{eventTitle(event.type, event.classification)}</span>
                    <span className="block truncate text-xs text-muted">{name(event.cameraId)}</span>
                  </span>
                  <span className="font-mono text-xs tabular-nums">{formatKolkataClock(new Date(event.timestamp)).slice(0, 5)}</span>
                </button>
              </li>
            ))}
          </ul>
          {result && result.total > result.pageSize ? (
            <div className="mt-3 flex gap-2">
              <button type="button" className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40" disabled={page <= 1} onClick={() => void search(page - 1)}>Previous</button>
              <button type="button" className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40" disabled={page * result.pageSize >= result.total} onClick={() => void search(page + 1)}>Next</button>
            </div>
          ) : null}
        </section>
        <EventDetail event={selected} cameraName={selected ? name(selected.cameraId) : ""} />
      </div>
    </div>
  );
}

function EventDetail({ event, cameraName }: { event: CctvEvent | null; cameraName: string }) {
  if (!event) return <p className="text-sm text-muted">Select an event.</p>;
  const seconds = eventDurationSeconds(event.timestamp, event.endTimestamp);
  return (
    <article className="min-w-0 rounded-xl border border-line bg-card p-4" aria-label="Event details">
      <h2 className="text-base font-semibold">{eventTitle(event.type, event.classification)}</h2>
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted">Camera</dt><dd>{cameraName}</dd>
        <dt className="text-muted">Time</dt><dd className="font-mono">{formatKolkataClock(new Date(event.timestamp))}</dd>
        <dt className="text-muted">Duration</dt><dd>{seconds === null ? Messages.notAvailable : `${seconds} seconds`}</dd>
        <dt className="text-muted">Type</dt><dd>{eventLabel(event.type, null)}</dd>
        <dt className="text-muted">Classification</dt><dd>{event.classification ? eventLabel(event.type, event.classification) : Messages.notAvailable}</dd>
        <dt className="text-muted">Confidence</dt><dd>{event.confidence === null ? Messages.notAvailable : `${Math.round(event.confidence * 100)}%`}</dd>
        <dt className="text-muted">Snapshot</dt><dd>{event.hasSnapshot ? "Available" : Messages.snapshotUnavailable}</dd>
      </dl>
      <Link href={eventPlaybackHref(event)} className="mt-4 inline-flex h-11 items-center rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f]">
        View recording
      </Link>
    </article>
  );
}
