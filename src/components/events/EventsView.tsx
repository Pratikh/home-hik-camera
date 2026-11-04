"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
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
} from "@/lib/events";
import { Messages } from "@/lib/messages";
import { formatKolkataClock, formatKolkataDateTimeFromIso, todayInKolkata } from "@/lib/time-kolkata";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { PriorityBadge } from "@/components/events/PriorityBadge";
import { useFocusTrap } from "@/components/hooks/useFocusTrap";

type QuickFilter = "all" | "person" | "vehicle" | "motion" | "important";

const QUICK: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "person", label: "Person" },
  { id: "vehicle", label: "Vehicle" },
  { id: "motion", label: "Motion" },
  { id: "important", label: "Important" },
];

/** Step a YYYY-MM-DD calendar date by a whole number of days. */
function shiftDay(value: string, delta: number): string {
  const date = new Date(`${value}T12:00:00`);
  date.setDate(date.getDate() + delta);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** "04 Nov 2026" for a YYYY-MM-DD day. */
function dayLabel(value: string): string {
  return formatKolkataDateTimeFromIso(`${value}T12:00:00+05:30`).split(",")[0] ?? value;
}

/** "04 Nov 2026" for an event timestamp (India time). */
function eventDateLabel(timestamp: string): string {
  return formatKolkataDateTimeFromIso(timestamp).split(",")[0] ?? timestamp.slice(0, 10);
}

/**
 * Group a page of events into hour buckets, preserving the server's
 * newest-first order. The API returns one day at a time, so the day is the
 * outer group and the hour is the dense inner marker of the timeline.
 */
function groupByHour(events: CctvEvent[]): { hour: string; events: CctvEvent[] }[] {
  const groups: { hour: string; events: CctvEvent[] }[] = [];
  for (const event of events) {
    const hour = formatKolkataClock(new Date(event.timestamp)).slice(0, 2);
    const last = groups[groups.length - 1];
    if (last && last.hour === hour) last.events.push(event);
    else groups.push({ hour, events: [event] });
  }
  return groups;
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
  /** Advanced filter panel — collapsed behind the toggle below the lg breakpoint. */
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Mobile event sheet. The auto-selected first event never opens it. */
  const [sheetOpen, setSheetOpen] = useState(false);
  /**
   * The date that produced the currently rendered `result`. The header and the
   * counts must follow this, never the draft value of a date input, or the
   * screen can label yesterday's rows with tomorrow's date.
   */
  const [appliedDate, setAppliedDate] = useState(initialDate);
  const [marking, setMarking] = useState(false);
  const [readNotice, setReadNotice] = useState<string | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  useFocusTrap(sheetOpen, inspectorRef, closeSheet);

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
    setSheetOpen(false);
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
      setAppliedDate(queryDate);
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

  /** The day navigator jumps straight to a day; the panel Date waits for Search. */
  function chooseDay(next: string) {
    setDate(next);
    void search(1, { date: next });
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

  /** Non-default advanced filters, shown as the count on the mobile toggle. */
  const advancedActive =
    (camera !== "all" ? 1 : 0) +
    (classification !== "all" ? 1 : 0) +
    (read !== "all" ? 1 : 0) +
    (notified !== "all" ? 1 : 0) +
    (priority !== "all" ? 1 : 0) +
    (startTime !== "00:00" ? 1 : 0) +
    (endTime !== "23:59" ? 1 : 0);

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

  function selectEvent(event: CctvEvent) {
    setSelected(event);
    // The sheet is a phone affordance only; desktop keeps the sticky inspector.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      setSheetOpen(true);
    }
  }

  /** Update one event's read state in the rendered page and in the selection. */
  function applyReadState(eventId: string, readAt: string | null) {
    setResult((current) =>
      current
        ? { ...current, events: current.events.map((item) => (item.id === eventId ? { ...item, readAt } : item)) }
        : current,
    );
    setSelected((current) => (current && current.id === eventId ? { ...current, readAt } : current));
  }

  async function markRead(eventId: string) {
    try {
      await api(`/api/events/${eventId}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read: true }),
      });
      applyReadState(eventId, new Date().toISOString());
      setReadNotice("Event marked read.");
      window.dispatchEvent(new CustomEvent("cctv-event"));
    } catch (caught) {
      setReadNotice(caught instanceof Error ? caught.message : "Could not mark the event read.");
    }
  }

  async function markAllRead() {
    setMarking(true);
    setReadNotice(null);
    try {
      const body = await api<{ updated: number }>("/api/events/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: appliedDate }),
      });
      const stamp = new Date().toISOString();
      setResult((current) =>
        current
          ? { ...current, events: current.events.map((item) => (item.readAt === null ? { ...item, readAt: stamp } : item)) }
          : current,
      );
      setSelected((current) => (current && current.readAt === null ? { ...current, readAt: stamp } : current));
      setReadNotice(`${body.updated} event${body.updated === 1 ? "" : "s"} marked read.`);
      window.dispatchEvent(new CustomEvent("cctv-event"));
    } catch (caught) {
      setReadNotice(caught instanceof Error ? caught.message : "Could not mark events read.");
    } finally {
      setMarking(false);
    }
  }

  const name = (id: number) => cameras[id] ?? `Camera ${id}`;
  const hours = result ? groupByHour(result.events) : [];
  const dayKey = appliedDate === todayInKolkata() ? "Today" : dayLabel(appliedDate);
  const appliedDayLabel = dayLabel(appliedDate);
  const draftDatePending = date !== appliedDate;

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Investigate"
        title="Events"
        detail="Motion events from the DVR, including person and vehicle labels when the DVR sends them."
        actions={
          <Link href="/events/stats" className="btn hidden sm:inline-flex">
            <Icon name="activity" className="icon icon-sm" />
            Statistics
          </Link>
        }
      />

      {/* Toolbox: day navigator, quick filters, then the collapsible panel. */}
      <div className="toolbar">
        <div className="datenav">
          <button
            type="button"
            aria-label="Previous day"
            className="icon-btn h-[26px] w-[26px] border-0 bg-transparent"
            onClick={() => chooseDay(shiftDay(date, -1))}
          >
            <Icon name="chevronLeft" className="icon icon-sm" />
          </button>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(event) => chooseDay(event.target.value)}
            aria-label="Selected day"
            required
          />
          <button
            type="button"
            aria-label="Next day"
            className="icon-btn h-[26px] w-[26px] border-0 bg-transparent"
            onClick={() => chooseDay(shiftDay(date, 1))}
          >
            <Icon name="chevronRight" className="icon icon-sm" />
          </button>
        </div>
        <button type="button" className="btn btn--sm" onClick={() => chooseDay(todayInKolkata())}>
          Today
        </button>

        <div className="seg" role="group" aria-label="Quick filters">
          {QUICK.map((item) => (
            <button
              key={item.id}
              type="button"
              className="seg__item"
              aria-pressed={quick === item.id}
              onClick={() => chooseQuick(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="toolbar__spacer" />
        <button
          type="button"
          className="btn lg:hidden"
          aria-expanded={filtersOpen}
          aria-controls="event-filters"
          onClick={() => setFiltersOpen((value) => !value)}
        >
          <Icon name="filter" className="icon icon-sm" />
          Filters
          {advancedActive > 0 ? <span className="chip chip--mono">{advancedActive}</span> : null}
          <Icon name="chevronDown" className={`icon icon-sm ${filtersOpen ? "rotate-180" : ""}`} />
        </button>
      </div>

      {/*
        Advanced filters: always open on desktop, collapsed behind the toggle on
        phones and tablets so the first event row lands in the first fold.
      */}
      <form
        id="event-filters"
        aria-label="Filters"
        className={`filter-panel ${filtersOpen ? "block" : "hidden"} lg:block`}
        onSubmit={(event) => {
          event.preventDefault();
          void search(1);
        }}
      >
        <div className="filter-grid">
          <label className="field">
            <span className="field__label">Camera</span>
            <select
              className="select"
              value={camera}
              onChange={(event) => setCamera(event.target.value)}
              aria-label="Camera"
            >
              <option value="all">All cameras</option>
              {CAMERA_IDS.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span className="field__label">Classification</span>
            <select
              className="select"
              value={classification}
              onChange={(event) => setClassification(event.target.value)}
              aria-label="Classification"
            >
              <option value="all">All</option>
              <option value="person">Person</option>
              <option value="vehicle">Vehicle</option>
              <option value="none">Unclassified</option>
            </select>
          </label>

          <label className="field">
            <span className="field__label">Date</span>
            <input
              type="date"
              className="input"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              aria-label="Date"
              required
            />
          </label>

          <label className="field">
            <span className="field__label">Priority</span>
            <select
              className="select"
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              aria-label="Priority"
            >
              <option value="all">All</option>
              <option value="LOW">Low</option>
              <option value="NORMAL">Normal</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select>
          </label>

          <label className="field">
            <span className="field__label">Start time</span>
            <input
              type="time"
              className="input"
              value={startTime}
              onChange={(event) => setStartTime(event.target.value)}
              aria-label="Start time"
            />
          </label>

          <label className="field">
            <span className="field__label">End time</span>
            <input
              type="time"
              className="input"
              value={endTime}
              onChange={(event) => setEndTime(event.target.value)}
              aria-label="End time"
            />
          </label>

          <label className="field">
            <span className="field__label">Read state</span>
            <select
              className="select"
              value={read}
              onChange={(event) => setRead(event.target.value)}
              aria-label="Read state"
            >
              <option value="all">Any</option>
              <option value="false">Unread</option>
              <option value="true">Read</option>
            </select>
          </label>

          <label className="field">
            <span className="field__label">Notification state</span>
            <select
              className="select"
              value={notified}
              onChange={(event) => setNotified(event.target.value)}
              aria-label="Notification state"
            >
              <option value="all">Any</option>
              <option value="true">Notification sent</option>
              <option value="false">Notification not sent</option>
            </select>
          </label>
        </div>

        <div className="filter-panel__foot">
          <button type="submit" className="btn btn--primary">
            <Icon name="search" className="icon icon-sm" />
            {loading ? "Searching..." : "Search"}
          </button>
          {filtersActive ? (
            <button type="button" className="btn btn--ghost" onClick={clearFilters}>
              Clear filters
            </button>
          ) : null}
          <span className="toolbar__spacer" />
          <span className="section__hint">
            {draftDatePending ? "Press Search to apply the new date. " : ""}Times use the hub&apos;s Asia/Kolkata clock.
          </span>
        </div>
      </form>

      {error ? <ErrorBanner message={error} onRetry={() => void search(page)} /> : null}

      <div className="events">
        <section className="events__list" aria-label="Event list" aria-busy={loading}>
          <p className="sr-only" role="status" aria-live="polite">
            {readNotice ?? (loading ? "Searching events." : `${result?.total ?? 0} events for ${appliedDayLabel}.`)}
          </p>
          <div className="section__head">
            <h2 className="section__title">Event list</h2>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span className="section__hint">
                {loading && !result ? "Loading events..." : `${result?.total ?? 0} events`}
              </span>
              <button
                type="button"
                className="btn btn--sm"
                onClick={() => void markAllRead()}
                disabled={marking || !result || result.total === 0}
              >
                <Icon name="check" className="icon icon-sm" />
                {marking ? "Marking..." : "Mark all read"}
              </button>
            </div>
          </div>

          <div className="day-group">
            <div className="day-group__head">
              <span>
                {dayKey}
                {dayKey === appliedDayLabel ? null : ` · ${appliedDayLabel}`}
              </span>
              <span className="chip chip--mono">{result?.total ?? 0} events</span>
            </div>

            {!result && loading ? <SkeletonRows rows={6} /> : null}

            {!loading && result && result.events.length === 0 ? (
              <EmptyState
                icon="events"
                title={filtersActive ? "No events match your filters." : Messages.noEvents}
                detail={
                  filtersActive
                    ? "Clear the filters or pick another day to see what the DVR recorded."
                    : "The DVR recorded nothing for this day."
                }
                action={
                  filtersActive ? (
                    <button type="button" className="btn btn--sm" onClick={clearFilters}>
                      Clear filters
                    </button>
                  ) : null
                }
              />
            ) : null}

            {hours.map((group) => (
              <div key={group.hour} className="mt-3 first:mt-1">
                <div className="flex items-center gap-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-faint">
                  <span className="font-mono">{group.hour}:00</span>
                  <span className="h-px flex-1 bg-line" />
                  <span>{group.events.length}</span>
                </div>
                <ul className="event-list">
                  {group.events.map((event) => {
                    const seconds = eventDurationSeconds(event.timestamp, event.endTimestamp);
                    return (
                      <li key={event.id}>
                        <button
                          type="button"
                          className="event-row"
                          aria-pressed={selected?.id === event.id}
                          onClick={() => selectEvent(event)}
                        >
                          <span className="event-row__time">
                            {formatKolkataClock(new Date(event.timestamp)).slice(0, 5)}
                          </span>
                          <span className="event-row__thumb">
                            {event.hasSnapshot ? (
                              // Snapshots are served only through the authenticated
                              // route, so the Next.js image optimizer cannot be used.
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={`/api/events/${event.id}/snapshot`} alt="" loading="lazy" />
                            ) : (
                              <span className="event-row__thumb--empty">
                                <Icon name="image" className="icon icon-sm" />
                              </span>
                            )}
                          </span>
                          <span className="event-row__main">
                            <span className="event-row__title">
                              <span>{eventTitle(event.type, event.classification)}</span>
                              <PriorityBadge priority={event.priority} />
                              {event.readAt === null ? <span className="chip chip--teal">New</span> : null}
                            </span>
                            <span className="event-row__meta">
                              <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">
                                {name(event.cameraId)}
                              </span>
                              <span className="sep">·</span>
                              <span className="whitespace-nowrap">
                                {event.notified ? "Notified" : "Not sent"}
                              </span>
                              {seconds === null ? null : (
                                <>
                                  <span className="sep hide-sm">·</span>
                                  <span className="hide-sm whitespace-nowrap">{seconds} s</span>
                                </>
                              )}
                            </span>
                          </span>
                          <span className="event-row__state">
                            <Icon name="chevronRight" className="icon icon-sm" />
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>

          {result && result.total > result.pageSize ? (
            <div className="pagination">
              <button
                type="button"
                className="btn btn--sm"
                disabled={page <= 1}
                onClick={() => void search(page - 1)}
              >
                <Icon name="chevronLeft" className="icon icon-sm" />
                Previous
              </button>
              <span className="pagination__count">
                Page {page} of {Math.max(1, Math.ceil(result.total / result.pageSize))}
              </span>
              <button
                type="button"
                className="btn btn--sm"
                disabled={page * result.pageSize >= result.total}
                onClick={() => void search(page + 1)}
              >
                Next
                <Icon name="chevronRight" className="icon icon-sm" />
              </button>
            </div>
          ) : null}
        </section>

        {selected ? (
          <EventInspector
            event={selected}
            cameraName={name(selected.cameraId)}
            open={sheetOpen}
            onClose={closeSheet}
            onMarkRead={(eventId) => void markRead(eventId)}
            containerRef={inspectorRef}
          />
        ) : null}

        {sheetOpen ? (
          <div className="events__sheet-backdrop" aria-hidden="true" onClick={() => setSheetOpen(false)} />
        ) : null}
      </div>
    </div>
  );
}

/** The snapshot in the inspector; a 404 falls back to the honest "unavailable". */
function InspectorSnapshot({ eventId, title }: { eventId: string; title: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="flex h-full items-center justify-center px-4 text-center text-xs text-muted">
        {Messages.snapshotUnavailable}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={`/api/events/${eventId}/snapshot`} alt={`Snapshot for ${title}`} onError={() => setFailed(true)} />
  );
}

/**
 * Event detail panel. Desktop: sticky card in the right column. Phones: the
 * same single `<article>` becomes a bottom sheet when a row is tapped; it is
 * rendered but hidden until then, so an auto-selected first event does not pop
 * a sheet over the list on load.
 */
export function EventInspector({
  event,
  cameraName,
  open,
  onClose,
  onMarkRead,
  containerRef,
}: {
  event: CctvEvent;
  cameraName: string;
  open: boolean;
  onClose: () => void;
  onMarkRead?: (eventId: string) => void;
  containerRef?: RefObject<HTMLElement | null>;
}) {
  const seconds = eventDurationSeconds(event.timestamp, event.endTimestamp);
  const title = eventTitle(event.type, event.classification);

  return (
    <article
      ref={containerRef as RefObject<HTMLElement>}
      className="card inspector events__inspector"
      aria-label="Event details"
      data-open={open ? "true" : "false"}
      tabIndex={-1}
    >
      <div className="inspector__img" style={{ borderRadius: "11px 11px 0 0" }}>
        {event.hasSnapshot ? (
          <InspectorSnapshot key={event.id} eventId={event.id} title={title} />
        ) : (
          <span className="flex h-full items-center justify-center px-4 text-center text-xs text-muted">
            {Messages.snapshotUnavailable}
          </span>
        )}
        <div className="inspector__badges">
          <PriorityBadge priority={event.priority} />
          {event.readAt === null ? <span className="badge badge--info">Unread</span> : null}
        </div>
        <button
          type="button"
          aria-label="Close event details"
          className="icon-btn events__sheet-close absolute right-2 top-2 bg-black/60"
          onClick={onClose}
        >
          <Icon name="close" />
        </button>
      </div>

      <div className="inspector__body">
        <div className="inspector__title">
          <h2>{title}</h2>
          <span className="badge badge--mono">{formatKolkataClock(new Date(event.timestamp))}</span>
        </div>
        <div className="inspector__meta">
          <span>{cameraName}</span>
          <span className="sep">·</span>
          <span>{eventDateLabel(event.timestamp)}</span>
          {seconds === null ? null : (
            <>
              <span className="sep">·</span>
              <span>{seconds} seconds</span>
            </>
          )}
        </div>

        <div className="inspector__props">
          <dl className="prop-list">
            <dt>Camera</dt>
            <dd>{cameraName}</dd>
            <dt>Time</dt>
            <dd className="mono">{formatKolkataClock(new Date(event.timestamp))}</dd>
            <dt>Duration</dt>
            <dd>{seconds === null ? Messages.notAvailable : `${seconds} seconds`}</dd>
            <dt>Type</dt>
            <dd>{eventLabel(event.type, null)}</dd>
            <dt>Classification</dt>
            <dd>{event.classification ? eventLabel(event.type, event.classification) : Messages.notAvailable}</dd>
            <dt>Confidence</dt>
            <dd>{event.confidence === null ? Messages.notAvailable : `${Math.round(event.confidence * 100)}%`}</dd>
            <dt>Notified</dt>
            <dd>{event.notified ? "Yes" : "No"}</dd>
          </dl>
        </div>

        <div className="inspector__actions">
          {event.readAt === null && onMarkRead ? (
            <button type="button" className="btn" onClick={() => onMarkRead(event.id)}>
              <Icon name="check" className="icon icon-sm" />
              Mark read
            </button>
          ) : null}
          <Link href={eventPlaybackHref(event)} className="btn btn--primary">
            <Icon name="playback" className="icon icon-sm" />
            View recording
          </Link>
          <Link href={`/events/${event.id}`} className="btn">
            <Icon name="arrowRight" className="icon icon-sm" />
            Open details
          </Link>
        </div>
      </div>
    </article>
  );
}
