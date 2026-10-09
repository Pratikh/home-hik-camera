"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthBody, sessionBody] = await Promise.all([
        api<Health>("/api/health"),
        api<Sessions>("/api/system/sessions"),
      ]);
      setHealth(healthBody);
      setSessions(sessionBody);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="min-w-0">
      <PageIntro title="System" detail="Live status from this hub, the DVR, and MediaMTX. Empty MediaMTX reader counts mean the gateway did not answer." />

      {loading && !health && !sessions ? <p className="text-sm text-muted">Loading system status...</p> : null}
      {error ? (
        <div className="mb-4 flex items-center gap-3 text-sm text-warn" role="alert">
          <span>Unable to load system status.</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-line px-3 py-1">Retry</button>
        </div>
      ) : null}
      {!loading && !error && !health && !sessions ? <p className="text-sm text-muted">No status available.</p> : null}

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