"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { PageIntro } from "@/components/ui/States";

type Health = { application: string; database: string; dvr: string; mediamtx: string; events: string; videoGateway: string };
type Sessions = {
  activeSessions: number;
  liveViewers: number;
  cameras: Array<{ id: number; appViewers: number; mediamtxReaders: number | null }>;
};

export default function SystemPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [sessions, setSessions] = useState<Sessions | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => {
      void api<Health>("/api/health").then(setHealth).catch(() => undefined);
      void api<Sessions>("/api/system/sessions").then(setSessions).catch(() => undefined);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-w-0">
      <PageIntro title="System" detail="Live status from this hub, the DVR, and MediaMTX. Empty MediaMTX reader counts mean the gateway did not answer." />
      {health ? (
        <dl className="mb-4 grid gap-2 rounded-xl border border-line bg-card p-4 text-sm sm:grid-cols-2">
          <div>Application: {health.application}</div>
          <div>Database: {health.database}</div>
          <div>DVR: {health.dvr}</div>
          <div>MediaMTX: {health.mediamtx}</div>
          <div>Events: {health.events}</div>
        </dl>
      ) : null}
      {sessions ? (
        <section className="rounded-xl border border-line bg-card p-4 text-sm">
          <p>Active sessions: {sessions.activeSessions}</p>
          <p>Live viewers reported by the app: {sessions.liveViewers}</p>
          <ul className="mt-3 space-y-1">
            {sessions.cameras.map((camera) => (
              <li key={camera.id}>
                Camera {camera.id}: {camera.appViewers} app viewer{camera.appViewers === 1 ? "" : "s"}
                {camera.mediamtxReaders === null ? "" : `, ${camera.mediamtxReaders} MediaMTX reader${camera.mediamtxReaders === 1 ? "" : "s"}`}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
