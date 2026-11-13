"use client";

import { useCallback, useEffect, useState } from "react";
import type { SystemHealthBody } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { formatKolkataDateTimeFromIso, humanizeSecondsInText } from "@/lib/time-kolkata";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";

type Health = { application: string; database: string; dvr: string; mediamtx: string; events: string; videoGateway: string };
type Sessions = {
  activeSessions: number;
  liveViewers: number;
  cameras: Array<{ id: number; appViewers: number; mediamtxReaders: number | null }>;
};

type Tone = "online" | "offline" | "warn" | "idle";

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

/** India-time stamp for an ISO string; raw UTC is never shown in the UI. */
function when(value: string | null | undefined): string {
  if (!value) return "unknown";
  return formatKolkataDateTimeFromIso(value);
}

function badge(tone: Tone): string {
  if (tone === "online") return "badge--online";
  if (tone === "offline") return "badge--danger";
  if (tone === "warn") return "badge--warn";
  return "";
}

function dot(tone: Tone): string {
  if (tone === "online") return "dot--online";
  if (tone === "offline") return "dot--offline";
  if (tone === "warn") return "dot--warn";
  return "dot--idle";
}

function HealthCard({
  icon,
  label,
  tone,
  value,
  detail,
}: {
  icon: IconName;
  label: string;
  tone: Tone;
  value: string;
  detail: string;
}) {
  return (
    <div className="health-card">
      <div className="health-card__head">
        <Icon name={icon} className="icon icon-sm" />
        {label}:
        <span className={`dot ${dot(tone)}`} />
      </div>
      <div className="health-card__value">
        <span className={`badge ${badge(tone)}`}>{value}</span> · {detail}
      </div>
    </div>
  );
}

function statusTone(value: string | boolean | null | undefined, good: string): Tone {
  if (value === null || value === undefined) return "idle";
  if (value === good) return "online";
  if (typeof value === "boolean") return value ? "online" : "offline";
  return value === "unknown" ? "idle" : "warn";
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

  const overallTone: Tone =
    detailed?.status === "healthy" ? "online" : detailed?.status === "degraded" ? "warn" : detailed ? "offline" : "idle";

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <PageHeader
        eyebrow="Administration"
        title="System"
        detail="Live status from this hub, the DVR, MediaMTX, and the background workers. Anything the hub cannot determine is reported as unknown."
        actions={
          <>
            <span className={`pill${overallTone === "online" ? "" : overallTone === "idle" ? "" : " pill--warn"}`}>
              <span className={`dot ${dot(overallTone)}`} />
              {detailed
                ? `${detailed.status === "healthy" ? "Healthy" : detailed.status === "degraded" ? "Degraded" : "Unhealthy"} · checked ${when(detailed.checkedAt).split(", ").pop()}`
                : Messages.checking}
            </span>
            <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
              <Icon name="refresh" className="icon icon-sm" />
              Refresh
            </button>
          </>
        }
      />

      {loading && !health && !detailed && !sessions ? <p className="section__hint">Loading system status...</p> : null}
      {error ? (
        <div className="notice notice--danger" role="alert" style={{ alignItems: "center" }}>
          <Icon name="alert" />
          <span>Unable to load system status.</span>
          <button type="button" onClick={() => void load()} className="btn btn--sm" style={{ marginLeft: "auto" }}>
            Retry
          </button>
        </div>
      ) : null}
      {!loading && !error && !health && !detailed && !sessions ? (
        <p className="section__hint">No status available.</p>
      ) : null}

      {detailed && detailed.warnings.length > 0 ? (
        <div className="notice notice--warn" role="status">
          <Icon name="alert" />
          <div style={{ minWidth: 0 }}>
            <strong>Needs attention ({detailed.status})</strong>
            <ul style={{ margin: "6px 0 0", paddingLeft: 18, listStyle: "disc", display: "grid", gap: 3, fontSize: "var(--fs-12)" }}>
              {detailed.warnings.map((warning) => (
                <li key={warning}>{humanizeSecondsInText(warning)}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : null}

      {(health || detailed) && (
        <div className="health-grid">
          <HealthCard
            icon="zap"
            label="Application"
            tone={statusTone(health?.application, "ok")}
            value={health?.application ?? "unknown"}
            detail="the hub answered this request"
          />
          <HealthCard
            icon="database"
            label="Database"
            tone={statusTone(detailed?.database.status ?? health?.database, "ok")}
            value={detailed?.database.status ?? health?.database ?? "unknown"}
            detail={
              detailed?.database.events !== null && detailed?.database.events !== undefined
                ? `${detailed.database.events.toLocaleString("en-IN")} events`
                : "local store"
            }
          />
          <HealthCard
            icon="device"
            label="DVR"
            tone={statusTone(health?.dvr, "connected")}
            value={health?.dvr ?? "unknown"}
            detail="local network recorder"
          />
          <HealthCard
            icon="wifi"
            label="MediaMTX"
            tone={statusTone(detailed?.mediamtx.status ?? health?.mediamtx, "ok")}
            value={detailed?.mediamtx.status ?? health?.mediamtx ?? "unknown"}
            detail={
              detailed
                ? `${detailed.mediamtx.paths.length} path${detailed.mediamtx.paths.length === 1 ? "" : "s"}${
                    detailed.mediamtx.drift ? " · DVR address drift" : ""
                  }`
                : "video gateway"
            }
          />
          <HealthCard
            icon="activity"
            label="Events ingestion"
            tone={statusTone(detailed?.events.ingestion ?? health?.events, "running")}
            value={detailed?.events.ingestion ?? health?.events ?? "unknown"}
            detail={detailed?.events.lastPoll ? `last poll ${when(detailed.events.lastPoll)}` : "no poll recorded"}
          />
          <HealthCard
            icon="image"
            label="Thumbnails"
            tone={
              detailed
                ? detailed.thumbnails.worker === "running"
                  ? "online"
                  : detailed.thumbnails.worker === "disabled"
                    ? "idle"
                    : "warn"
                : "idle"
            }
            value={detailed?.thumbnails.worker ?? "unknown"}
            detail={detailed ? `${detailed.thumbnails.queued ?? 0} queued · ${bytes(detailed.thumbnails.diskBytes)}` : "previews"}
          />
          <HealthCard
            icon="database"
            label="Storage"
            tone={detailed ? (detailed.storage.status === "ok" ? "online" : detailed.storage.status === "unknown" ? "idle" : "warn") : "idle"}
            value={detailed?.storage.usedPercent !== null && detailed?.storage.usedPercent !== undefined ? `${detailed.storage.usedPercent}%` : "unknown"}
            detail={
              detailed && detailed.storage.freeBytes !== null && detailed.storage.totalBytes !== null
                ? `${bytes(detailed.storage.freeBytes)} free of ${bytes(detailed.storage.totalBytes)}`
                : "data volume"
            }
          />
        </div>
      )}

      <div className="split" style={{ minWidth: 0 }}>
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <section className="card" style={{ minWidth: 0 }}>
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="wifi" className="icon icon-sm" />
                MediaMTX paths
              </h2>
              <span className="status">
                <span className={`dot ${statusTone(detailed?.mediamtx.status, "ok") === "online" ? "dot--online" : "dot--idle"}`} aria-hidden="true" />
                <span className="status__text">
                  {detailed ? `${detailed.mediamtx.paths.length} configured` : "checking"}
                </span>
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="table table--stack" style={{ minWidth: 560 }}>
                <thead>
                  <tr>
                    <th>Path</th>
                    <th>Tracks</th>
                    <th>Inbound</th>
                    <th>State</th>
                  </tr>
                </thead>
                <tbody>
                  {(detailed?.mediamtx.paths ?? []).map((path) => (
                    <tr key={path.path}>
                      <td className="num" data-label="Path">
                        {path.path}
                      </td>
                      <td className="num" data-label="Tracks">
                        {path.tracks}
                      </td>
                      <td className="num" data-label="Inbound">
                        {bytes(path.bytesReceived)}
                      </td>
                      <td data-label="State">
                        <span className="status">
                          <span className={`dot ${path.ready ? "dot--online" : "dot--idle"}`} aria-hidden="true" />
                          <span className="status__text">{path.ready ? "Ready" : "Idle"}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                  {detailed && detailed.mediamtx.paths.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="section__hint" data-label="Paths">
                        MediaMTX is not reporting any camera paths.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <div className="card__foot">
              <span className="section__hint">
                Main streams stay on the LAN and are only opened for playback. Sub streams feed the live grid and the
                detection worker.
              </span>
            </div>
          </section>

          <section className="card" style={{ minWidth: 0 }}>
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="activity" className="icon icon-sm" />
                Event ingestion
              </h2>
              <span className={`badge ${badge(statusTone(detailed?.events.ingestion, "running"))}`}>
                {detailed?.events.ingestion ?? health?.events ?? "unknown"}
              </span>
            </div>
            <div className="card__body">
              <dl className="prop-list">
                <dt>Last poll</dt>
                <dd className="mono">{when(detailed?.events.lastPoll)}</dd>
                <dt>Last error</dt>
                <dd>{detailed?.events.lastError ?? "none reported"}</dd>
              </dl>
            </div>
          </section>
        </div>

        <aside style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <section className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="activity" className="icon icon-sm" />
                Active sessions
              </h2>
              <span className="badge badge--mono">{sessions ? `${sessions.liveViewers} live viewer${sessions.liveViewers === 1 ? "" : "s"}` : "checking"}</span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 12 }}>
              <dl className="prop-list">
                <dt>Active sessions:</dt>
                <dd className="mono">{sessions ? sessions.activeSessions : "unknown"}</dd>
                <dt>Live viewers:</dt>
                <dd className="mono">{sessions ? sessions.liveViewers : "unknown"}</dd>
              </dl>
              <div style={{ overflowX: "auto" }}>
                <table className="table table--stack" style={{ minWidth: 280 }}>
                  <thead>
                    <tr>
                      <th>Camera</th>
                      <th>App viewers</th>
                      <th>MediaMTX readers</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(sessions?.cameras ?? []).map((camera) => (
                      <tr key={camera.id}>
                        <td data-label="Camera">Camera {camera.id}</td>
                        <td className="num" data-label="App viewers">
                          {camera.appViewers}
                        </td>
                        <td className="num" data-label="MediaMTX readers">
                          {camera.mediamtxReaders === null ? "unknown" : camera.mediamtxReaders}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

<section className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="image" className="icon icon-sm" />
                Thumbnails
              </h2>
              <span className={`badge ${detailed?.thumbnails.enabled ? "badge--online" : ""}`}>
                {detailed ? (detailed.thumbnails.enabled ? "enabled" : "off") : "checking"}
              </span>
            </div>
            <div className="card__body">
              <dl className="prop-list">
                <dt>Worker</dt>
                <dd className="mono">{detailed?.thumbnails.worker ?? "unknown"}</dd>
                <dt>Queued jobs</dt>
                <dd className="mono">{detailed?.thumbnails.queued ?? "unknown"}</dd>
                <dt>Last run</dt>
                <dd>{when(detailed?.thumbnails.lastRunAt)}</dd>
                <dt>Generated data</dt>
                <dd className="mono">{bytes(detailed?.thumbnails.diskBytes ?? null)}</dd>
                {detailed?.thumbnails.lastError ? (
                  <>
                    <dt>Last error</dt>
                    <dd className="section__hint">{detailed.thumbnails.lastError}</dd>
                  </>
                ) : null}
              </dl>
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="database" className="icon icon-sm" />
                Storage and retention
              </h2>
              <span className={`badge ${badge(statusTone(detailed?.storage.status, "ok"))}`}>
                {detailed?.storage.status ?? "unknown"}
              </span>
            </div>
            <div className="card__body">
              <dl className="prop-list">
                <dt>Data volume</dt>
                <dd className="mono">
                  {detailed && detailed.storage.freeBytes !== null && detailed.storage.totalBytes !== null
                    ? `${bytes(detailed.storage.freeBytes)} free of ${bytes(detailed.storage.totalBytes)}`
                    : "unknown"}
                </dd>
                <dt>Used</dt>
                <dd className="mono">{detailed?.storage.usedPercent !== null && detailed?.storage.usedPercent !== undefined ? `${detailed.storage.usedPercent}%` : "unknown"}</dd>
                <dt>Backup status</dt>
                <dd className="mono">{detailed?.backups.status ?? "unknown"}</dd>
                <dt>Last backup</dt>
                <dd>{when(detailed?.backups.lastSuccessAt)}</dd>
                <dt>Backup age</dt>
                <dd>{age(detailed?.backups.ageSeconds ?? null)}</dd>
                <dt>Retention</dt>
                <dd className="mono">{detailed?.retention.status ?? "unknown"}</dd>
                <dt>Last retention run</dt>
                <dd>{when(detailed?.retention.lastRunAt)}</dd>
              </dl>
              {detailed?.backups.detail ? <p className="section__hint" style={{ marginTop: 8 }}>{detailed.backups.detail}</p> : null}
              {detailed?.retention.lastError ? <p className="section__hint" style={{ marginTop: 8 }}>{detailed.retention.lastError}</p> : null}
            </div>
            <div className="card__foot">
              <span className="section__hint">Retention deletes this hub&apos;s own rows and snapshots; DVR recordings are untouched.</span>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
