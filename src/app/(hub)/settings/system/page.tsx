"use client";

import { useCallback, useEffect, useState } from "react";
import type { SystemHealthBody } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { PageIntro } from "@/components/ui/States";

type Health = { application: string; database: string; dvr: string; mediamtx: string; events: string; videoGateway: string };
type Sessions = {
  activeSessions: number;
  liveViewers: number;
  cameras: Array<{ id: number; appViewers: number; mediamtxReaders: number | null }>;
};

function bytes(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "unknown";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function age(seconds: number | null): string {
  if (seconds === null) return "unknown";
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export default function SystemPage() {
  const [health, setHealth] = useState<Health | null>(null);
  const [detailed, setDetailed] = useState<SystemHealthBody | null>(null);
  const [sessions, setSessions] = useState<Sessions | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthBody, detailBody, sessionBody] = await Promise.all([
        api<Health>("/api/health"),
        api<SystemHealthBody>("/api/system/health"),
        api<Sessions>("/api/system/sessions"),
      ]);
      setHealth(healthBody);
      setDetailed(detailBody);
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

  const face = detailed?.faceDetection;
  const faceProblem = Boolean(face?.enabled && face.worker !== "running");

  return (
    <div className="min-w-0">
      <PageIntro
        title="System"
        detail="Live status from this hub, the DVR, MediaMTX, and the background workers. Anything the hub cannot determine is reported as unknown."
      />

      {loading && !health && !detailed && !sessions ? <p className="text-sm text-muted">Loading system status...</p> : null}
      {error ? (
        <div className="mb-4 flex items-center gap-3 text-sm text-warn" role="alert">
          <span>Unable to load system status.</span>
          <button type="button" onClick={() => void load()} className="rounded-lg border border-line px-3 py-1">Retry</button>
        </div>
      ) : null}
      {!loading && !error && !health && !detailed && !sessions ? <p className="text-sm text-muted">No status available.</p> : null}

      {detailed && detailed.warnings.length > 0 ? (
        <div className="mb-4 rounded-xl border border-warn/50 bg-card p-4 text-sm" role="status">
          <p className="font-semibold text-warn">Needs attention ({detailed.status})</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {detailed.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {faceProblem ? (
        <div className="mb-4 rounded-xl border border-warn/50 bg-card p-4 text-sm" role="alert">
          <p className="font-semibold text-warn">Face detection is enabled but its worker is not processing jobs.</p>
          <p className="mt-1 text-muted">
            {face?.warning ??
              "Start the local worker (face-worker or the home-cctv-face-worker systemd service) and check its logs."}
          </p>
        </div>
      ) : null}

      {health ? (
        <dl className="mb-4 grid gap-2 rounded-xl border border-line bg-card p-4 text-sm sm:grid-cols-2">
          <div>Application: {health.application}</div>
          <div>Database: {health.database}</div>
          <div>DVR: {health.dvr}</div>
          <div>MediaMTX: {health.mediamtx}</div>
          <div>Events: {health.events}</div>
          {detailed ? <div>Overall: {detailed.status}</div> : null}
        </dl>
      ) : null}

      {detailed ? (
        <div className="mb-4 grid gap-3 md:grid-cols-2">
          <section className="rounded-xl border border-line bg-card p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold">Face detection</h2>
            {face?.enabled ? (
              <ul className="space-y-1">
                <li>Worker: <span className={face.worker === "running" ? "text-online" : "text-warn"}>{face.worker}</span></li>
                <li>Last heartbeat: {face.lastHeartbeat ? `${age(face.heartbeatAgeSeconds)}` : "never"}</li>
                {face.queue ? (
                  <li>
                    Queue: {face.queue.pending} pending, {face.queue.processing} processing, {face.queue.failed} failed,{" "}
                    {face.queue.completed} completed
                  </li>
                ) : (
                  <li>Queue: unknown</li>
                )}
                {face.detail ? <li className="text-muted">Last worker note: {face.detail}</li> : null}
              </ul>
            ) : (
              <p className="text-muted">Face detection is disabled. No worker is expected to run.</p>
            )}
          </section>

          <section className="rounded-xl border border-line bg-card p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold">Thumbnails</h2>
            <ul className="space-y-1">
              <li>Enabled: {detailed.thumbnails.enabled ? "yes" : "no"}</li>
              <li>Worker: {detailed.thumbnails.worker}</li>
              <li>Queued camera/day jobs: {detailed.thumbnails.queued ?? "unknown"}</li>
              <li>Last run: {detailed.thumbnails.lastRunAt ?? "not yet"}</li>
              <li>Generated data: {bytes(detailed.thumbnails.diskBytes)}</li>
              {detailed.thumbnails.lastError ? <li className="text-warn">Last error: {detailed.thumbnails.lastError}</li> : null}
            </ul>
          </section>

          <section className="rounded-xl border border-line bg-card p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold">Storage and backups</h2>
            <ul className="space-y-1">
              <li>
                Data volume: {detailed.storage.status === "ok"
                  ? `${bytes(detailed.storage.freeBytes)} free of ${bytes(detailed.storage.totalBytes)} (${detailed.storage.usedPercent}% used)`
                  : "unknown"}
              </li>
              <li>Last successful backup: {detailed.backups.lastSuccessAt ?? "unknown"} ({age(detailed.backups.ageSeconds)})</li>
              <li>Backup status: {detailed.backups.status}</li>
              {detailed.backups.detail ? <li className="text-warn">Backup note: {detailed.backups.detail}</li> : null}
            </ul>
          </section>

          <section className="rounded-xl border border-line bg-card p-4 text-sm">
            <h2 className="mb-2 text-sm font-semibold">Retention and MediaMTX</h2>
            <ul className="space-y-1">
              <li>Retention: {detailed.retention.status}{detailed.retention.lastRunAt ? ` (last run ${detailed.retention.lastRunAt})` : ""}</li>
              {detailed.retention.removed ? (
                <li>
                  Last pass removed {detailed.retention.removed.events} events, {detailed.retention.removed.snapshots} snapshots,{" "}
                  {detailed.retention.removed.orphanedSnapshots} orphan snapshots, {detailed.retention.removed.crops} crops.
                </li>
              ) : null}
              {detailed.retention.lastError ? <li className="text-warn">Retention error: {detailed.retention.lastError}</li> : null}
              <li>MediaMTX reachable: {detailed.mediamtx.reachable === null ? "unknown" : detailed.mediamtx.reachable ? "yes" : "no"}</li>
              <li>Camera paths reporting: {detailed.mediamtx.paths.length}</li>
              {detailed.mediamtx.drift ? <li className="text-warn">MediaMTX is using a different DVR address.</li> : null}
            </ul>
          </section>
        </div>
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
