"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CctvEvent, EventStats } from "@/lib/events";
import { eventPlaybackHref, eventTitle } from "@/lib/events";
import { api } from "@/lib/client-api";
import { formatKolkataClock, todayInKolkata } from "@/lib/time-kolkata";

function dot(event: CctvEvent): string {
  if (event.classification === "person") return "bg-offline";
  if (event.classification === "vehicle") return "bg-warn";
  return "bg-teal";
}

export function RecentEvents() {
  const [events, setEvents] = useState<CctvEvent[]>([]);
  const [stats, setStats] = useState<EventStats | null>(null);

  async function reload() {
    const [recent, summary] = await Promise.all([
      api<{ events: CctvEvent[] }>("/api/events/recent?limit=5"),
      api<EventStats>(`/api/events/stats?date=${todayInKolkata()}`),
    ]);
    setEvents(recent.events);
    setStats(summary);
  }

  useEffect(() => {
    const timer = setTimeout(() => void reload().catch(() => undefined), 0);
    const onEvent = () => void reload().catch(() => undefined);
    window.addEventListener("cctv-event", onEvent);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("cctv-event", onEvent);
    };
  }, []);

  return (
    <section className="mt-6 min-w-0 rounded-xl border border-line bg-card p-4" aria-label="Recent events">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Recent events</h2>
        <Link href="/events" className="text-sm text-teal">View all events</Link>
      </div>
      {stats ? (
        <p className="mt-2 text-sm text-muted">
          Today: {stats.total} events. Person {stats.person}. Vehicle {stats.vehicle}. Motion {stats.motion}.
        </p>
      ) : null}
      {events.length === 0 ? <p className="mt-3 text-sm text-muted">No events stored yet.</p> : null}
      <ul className="mt-3 flex flex-col gap-2">
        {events.map((event) => (
          <li key={event.id}>
            <Link href={eventPlaybackHref(event)} className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-white/5">
              <span className={`h-2.5 w-2.5 rounded-full ${dot(event)}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate">{eventTitle(event.type, event.classification)}</span>
              <span className="text-muted">Camera {event.cameraId}</span>
              <span className="font-mono text-xs tabular-nums">{formatKolkataClock(new Date(event.timestamp)).slice(0, 5)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
