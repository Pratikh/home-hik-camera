"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { CamerasResponse, EventListResponse } from "@/lib/api-types";
import { CAMERA_IDS } from "@/lib/cameras";
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
import { PriorityBadge } from "@/components/events/PriorityBadge";

type QuickFilter = "all" | "person" | "vehicle" | "motion" | "important";

const QUICK: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "person", label: "Person" },
  { id: "vehicle", label: "Vehicle" },
  { id: "motion", label: "Motion" },
  { id: "important", label: "Important" },
];

function dot(classification: EventClassification | null, type: EventType): string {
  if (classification === "person" || type === "alarm") return "bg-offline";
  if (classification === "vehicle") return "bg-warn";
  return "bg-teal";
}

export function EventsView({ initialDate }: { initialDate: string }) {
  const params = useSearchParams();
  const [cameras, setCameras] = useState<Record<number, string>>({});
  const [quick, setQuick] = useState<QuickFilter>("all");
  const [camera, setCamera] = useState("all");
  const [classification, setClassification] = useState("all");
  const [date, setDate] = useState(initialDate);
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [read, setRead] = useState("all");
  const [notified, setNotified] = useState("all");
  const [priority, setPriority] = useState("all");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<EventListResponse | null>(null);
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

  /**
   * Server-side filtering. The browser sends the filters and receives one page;
   * it never downloads the day's events to filter them locally.
   */
  async function search(
    nextPage = 1,
    overrides?: Partial<{
      quick: QuickFilter;
      date: string;
      camera: string;
      classification: string;
      read: string;
      notified: string;
      priority: string;
      startTime: string;
      endTime: string;
    }>,
  ) {
    setLoading(true);
    setError(null);
    const activeQuick = overrides?.quick ?? quick;
    const queryDate = overrides?.date ?? date;
    const queryCamera = overrides?.camera ?? camera;
    const queryClassification = overrides?.classification ?? classification;
    const queryRead = overrides?.read ?? read;
    const queryNotified = overrides?.notified ?? notified;
    const queryPriority = overrides?.priority ?? priority;
    const queryStart = overrides?.startTime ?? startTime;
    const queryEnd = overrides?.endTime ?? endTime;

    const searchParams = new URLSearchParams({
      camera: queryCamera,
      date: queryDate,
      startTime: queryStart,
      endTime: queryEnd,
      page: String(nextPage),
      pageSize: "20",
    });
    if (activeQuick === "important") searchParams.set("important", "true");
    if (activeQuick === "person" || activeQuick === "vehicle") searchParams.set("classification", activeQuick);
    if (activeQuick === "motion") searchParams.set("classification", "none");
    else if (queryClassification !== "all") searchParams.set("classification", queryClassification);
    if (queryRead !== "all") searchParams.set("read", queryRead);
    if (queryNotified !== "all") searchParams.set("notified", queryNotified);
    if (queryPriority !== "all") searchParams.set("priority", queryPriority);

    try {
      const body = await api<EventListResponse>(`/api/events?${searchParams.toString()}`);
      setResult(body);
      setPage(nextPage);
      const focus = params.get("focus");
      const focused = body.events.find((event) => event.id === focus) ?? null;
      // The detail panel must always describe the current result set. Keeping a
      // previously selected event here would show an event that contradicts the
      // active filters (and the "0 events" count).
      setSelected((current) => {
        if (focused) return focused;
        const stillListed = current && body.events.some((event) => event.id === current.id) ? current : null;
        return stillListed ?? body.events[0] ?? null;
      });
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    } finally {
      setLoading(false);
    }
  }

  function chooseQuick(next: QuickFilter) {
    setQuick(next);
    void search(1, { quick: next });
  }

  /** True when anything beyond the date is narrowing the result set. */
  const filtersActive =
    quick !== "all" ||
    camera !== "all" ||
    classification !== "all" ||
    read !== "all" ||
    notified !== "all" ||
    priority !== "all" ||
    startTime !== "00:00" ||
    endTime !== "23:59";

  function clearFilters() {
    setQuick("all");
    setCamera("all");
    setClassification("all");
    setRead("all");
    setNotified("all");
    setPriority("all");
    setStartTime("00:00");
    setEndTime("23:59");
    void search(1, {
      quick: "all",
      camera: "all",
      classification: "all",
      read: "all",
      notified: "all",
      priority: "all",
      startTime: "00:00",
      endTime: "23:59",
    });
  }

  useEffect(() => {
    const timer = setTimeout(() => void search(1), 0);
    const onEvent = () => {
      // Only live-refresh the default view; a filtered view is left alone so the
      // list does not jump while it is being read.
      if (date === todayInKolkata() && camera === "all" && quick === "all" && read === "all" && notified === "all") {
        void search(1);
      }
    };
    window.addEventListener("cctv-event", onEvent);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("cctv-event", onEvent);
    };
    // The first search uses the initial filters. Later changes use the buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const name = (id: number) => cameras[id] ?? `Camera ${id}`;

  return (
    <div className="min-w-0">
      <PageIntro title="Events" detail="Motion events from the DVR, including person and vehicle labels when the DVR sends them." />

      <div className="mb-3 flex flex-wrap gap-2" role="group" aria-label="Quick filters">
        {QUICK.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-pressed={quick === item.id}
            onClick={() => chooseQuick(item.id)}
            className={`h-9 rounded-full border px-3 text-sm ${
              quick === item.id ? "border-teal bg-teal/10 text-teal" : "border-line text-muted hover:text-ink"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      <form
        className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          void search(1);
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block text-muted">Camera</span>
          <select value={camera} onChange={(event) => setCamera(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Camera">
            <option value="all">All cameras</option>
            {CAMERA_IDS.map((id) => <option key={id} value={id}>{name(id)}</option>)}
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
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">From</span>
            <input type="time" value={startTime} onChange={(event) => setStartTime(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Start time" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">To</span>
            <input type="time" value={endTime} onChange={(event) => setEndTime(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="End time" />
          </label>
        </div>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Read state</span>
          <select value={read} onChange={(event) => setRead(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Read state">
            <option value="all">Any</option>
            <option value="false">Unread</option>
            <option value="true">Read</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Notification</span>
          <select value={notified} onChange={(event) => setNotified(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Notification state">
            <option value="all">Any</option>
            <option value="true">Notification sent</option>
            <option value="false">Notification not sent</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Priority</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Priority">
            <option value="all">All</option>
            <option value="LOW">Low</option>
            <option value="NORMAL">Normal</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
        </label>
        <div className="flex flex-wrap gap-2 sm:col-span-2 xl:col-span-2">
          <button type="submit" className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f]">
            {loading ? "Searching..." : "Search"}
          </button>
          {filtersActive ? (
            <button type="button" onClick={clearFilters} className="h-11 rounded-lg border border-line px-4 text-sm">
              Clear filters
            </button>
          ) : null}
        </div>
      </form>

      {error ? <p className="mb-3 text-sm text-warn" role="alert">{error}</p> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <section className="min-w-0" aria-label="Event list">
          <h2 className="mb-2 text-sm font-semibold">
            {date === todayInKolkata() ? "Today" : date}
            {result ? <span className="ml-2 font-normal text-muted">{result.total} events</span> : null}
          </h2>
          {!loading && result && result.events.length === 0 ? (
            // Name the actual cause: filters are the common reason, not the date.
            <p className="text-sm text-muted">
              {filtersActive ? "No events match your filters." : Messages.noEvents}
            </p>
          ) : null}
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
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium">{eventTitle(event.type, event.classification)}</span>
                      <PriorityBadge priority={event.priority} />
                      {event.readAt === null ? <span className="text-[11px] text-teal">New</span> : null}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {name(event.cameraId)}
                      {event.notified ? " · notified" : ""}
                    </span>
                  </span>
                  <span className="font-mono text-xs tabular-nums">{formatKolkataClock(new Date(event.timestamp)).slice(0, 5)}</span>
                </button>
              </li>
            ))}
          </ul>
          {result && result.total > result.pageSize ? (
            <div className="mt-3 flex items-center gap-2">
              <button type="button" className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40" disabled={page <= 1} onClick={() => void search(page - 1)}>Previous</button>
              <span className="text-xs text-muted">Page {page} of {Math.max(1, Math.ceil(result.total / result.pageSize))}</span>
              <button type="button" className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40" disabled={page * result.pageSize >= result.total} onClick={() => void search(page + 1)}>Next</button>
            </div>
          ) : null}
        </section>
        <EventDetail event={selected} cameraName={selected ? name(selected.cameraId) : ""} />
      </div>
    </div>
  );
}

export function EventDetail({ event, cameraName }: { event: CctvEvent | null; cameraName: string }) {
  if (!event) return <p className="text-sm text-muted">Select an event.</p>;
  const seconds = eventDurationSeconds(event.timestamp, event.endTimestamp);
  return (
    <article className="min-w-0 rounded-xl border border-line bg-card p-4" aria-label="Event details">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold">{eventTitle(event.type, event.classification)}</h2>
        <PriorityBadge priority={event.priority} />
      </div>
      {event.hasSnapshot ? (
        // Snapshots are served only through the authenticated route, so the
        // Next.js image optimizer cannot be used: it fetches the URL itself,
        // without the viewer's session cookie.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`/api/events/${event.id}/snapshot`}
          alt={`Snapshot for ${eventTitle(event.type, event.classification)}`}
          className="mt-3 aspect-video w-full rounded-lg border border-line object-cover"
        />
      ) : (
        <p className="mt-3 rounded-lg border border-line bg-black/30 px-3 py-6 text-center text-xs text-muted">
          {Messages.snapshotUnavailable}
        </p>
      )}
      <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
        <dt className="text-muted">Camera</dt><dd>{cameraName}</dd>
        <dt className="text-muted">Time</dt><dd className="font-mono">{formatKolkataClock(new Date(event.timestamp))}</dd>
        <dt className="text-muted">Duration</dt><dd>{seconds === null ? Messages.notAvailable : `${seconds} seconds`}</dd>
        <dt className="text-muted">Type</dt><dd>{eventLabel(event.type, null)}</dd>
        <dt className="text-muted">Classification</dt><dd>{event.classification ? eventLabel(event.type, event.classification) : Messages.notAvailable}</dd>
        <dt className="text-muted">Confidence</dt><dd>{event.confidence === null ? Messages.notAvailable : `${Math.round(event.confidence * 100)}%`}</dd>
        <dt className="text-muted">Notified</dt><dd>{event.notified ? "Yes" : "No"}</dd>
      </dl>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link href={eventPlaybackHref(event)} className="inline-flex h-11 items-center rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f]">
          View recording
        </Link>
        <Link href={`/events/${event.id}`} className="inline-flex h-11 items-center rounded-lg border border-line px-4 text-sm">
          Open details
        </Link>
      </div>
    </article>
  );
}
