"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { CamerasResponse } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { ErrorBanner } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatusLamp } from "@/components/ui/StatusLamp";

/**
 * Camera management.
 *
 * The preview panel is a static, stylised frame: opening four more WebRTC/HLS
 * sessions on a settings screen would compete with the dashboard for the DVR's
 * substreams, so this page never starts a stream. Everything else — reading
 * `/api/cameras`, renaming a channel, clearing the override with "Use DVR name"
 * and the per-camera validation notices — is unchanged.
 */
export function CamerasView() {
  const [data, setData] = useState<CamerasResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [notices, setNotices] = useState<Record<number, string>>({});
  const [pendingId, setPendingId] = useState<number | null>(null);

  async function load() {
    try {
      const next = await api<CamerasResponse>("/api/cameras");
      setData(next);
      setDrafts(Object.fromEntries(next.cameras.map((camera) => [camera.id, camera.name])));
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function save(id: number) {
    setPendingId(id);
    setNotices((current) => ({ ...current, [id]: "" }));
    try {
      const saved = await api<{ id: number; name: string }>(`/api/cameras/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: drafts[id] ?? "" }),
      });
      setData((current) =>
        current
          ? {
              ...current,
              cameras: current.cameras.map((camera) => (camera.id === id ? { ...camera, name: saved.name } : camera)),
            }
          : current,
      );
      setDrafts((current) => ({ ...current, [id]: saved.name }));
      setNotices((current) => ({ ...current, [id]: "Saved" }));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setNotices((current) => ({
        ...current,
        [id]: caught instanceof Error ? caught.message : Messages.backendDown,
      }));
    } finally {
      setPendingId(null);
    }
  }

  async function applyDvrName(id: number) {
    setPendingId(id);
    setNotices((current) => ({ ...current, [id]: "" }));
    try {
      const saved = await api<{ id: number; name: string }>(`/api/cameras/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ useDvrName: true }),
      });
      setData((current) =>
        current
          ? {
              ...current,
              cameras: current.cameras.map((camera) => (camera.id === id ? { ...camera, name: saved.name } : camera)),
            }
          : current,
      );
      setDrafts((current) => ({ ...current, [id]: saved.name }));
      setNotices((current) => ({ ...current, [id]: "Using the DVR name" }));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setNotices((current) => ({
        ...current,
        [id]: caught instanceof Error ? caught.message : Messages.backendDown,
      }));
    } finally {
      setPendingId(null);
    }
  }

  const channelCount = data?.cameras.length ?? 0;

  return (
    <div className="min-w-0" style={{ maxWidth: 1240, margin: "0 auto" }}>
      <PageHeader
        eyebrow="Configure"
        title="Camera setup"
        detail="Names come from the DVR channel configuration. Saving a name here overrides it on this hub only; the DVR keeps its own name."
        actions={
          <Link href="/" className="btn">
            <Icon name="camera" className="icon icon-sm" />
            Open live view
          </Link>
        }
      />

      {error && !data ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}

      {data ? (
        <section className="card" aria-label="DVR and video gateway status">
          <div
            className="card__body"
            style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "10px 24px", padding: "12px 16px" }}
          >
            <StatusLamp
              tone={data.dvr === "connected" ? "online" : data.dvr === "disconnected" ? "offline" : "warn"}
              label={data.dvrMessage}
            />
            <StatusLamp
              tone={data.videoGateway === "connected" ? "online" : "offline"}
              label={data.videoGateway === "connected" ? Messages.gatewayUp : Messages.gatewayDown}
            />
            <span className="status">
              <span className="dot dot--idle" aria-hidden="true" />
              <span className="status__text">
                {channelCount} channel{channelCount === 1 ? "" : "s"} configured
              </span>
            </span>
            <span className="section__hint" style={{ marginLeft: "auto" }}>
              Renames apply to this hub only
            </span>
          </div>
        </section>
      ) : null}

      <section className="section" style={{ marginTop: 16 }}>
        <div className="section__head" style={{ marginBottom: 8 }}>
          <h2 className="section__title">Channels</h2>
          <span className="section__hint">
            {data ? `${channelCount} channels · H.264 sub streams` : Messages.checking}
          </span>
        </div>

        <div className="split">
          <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
            <div className="cam-grid md:grid-cols-2">
              {(data?.cameras ?? []).map((camera) => {
                const blocked =
                  data && (data.dvr !== "connected" || data.videoGateway !== "connected" || camera.online === false);
                const stream = !data
                  ? Messages.checking
                  : data.dvr !== "connected"
                    ? data.dvrMessage
                    : data.videoGateway !== "connected"
                      ? Messages.gatewayDown
                      : camera.online === false
                        ? Messages.cameraUnavailable
                        : "Ready to view";
                const onlineLabel =
                  camera.online === true
                    ? Messages.online
                    : camera.online === false
                      ? Messages.offline
                      : Messages.notReported;
                const deviceTone = camera.online === true ? "online" : camera.online === false ? "offline" : "warn";
                const previewBadge =
                  camera.online === true
                    ? "badge badge--online"
                    : camera.online === false
                      ? "badge badge--danger"
                      : "badge badge--warn";
                const previewDot =
                  camera.online === true
                    ? "dot dot--online"
                    : camera.online === false
                      ? "dot dot--offline"
                      : "dot dot--warn";

                return (
                  <article key={camera.id} className="card cam-card">
                    <div className="cam-card__preview">
                      <div style={{ display: "grid", justifyItems: "center", gap: 9, textAlign: "center", padding: 12 }}>
                        <span
                          className="camera__glyph"
                          style={{
                            display: "grid",
                            placeItems: "center",
                            width: 46,
                            height: 46,
                            borderRadius: 999,
                            border: "1px solid var(--line-2)",
                            background: "rgba(255,255,255,0.03)",
                          }}
                        >
                          <Icon name="camera" style={{ width: 22, height: 22 }} />
                        </span>
                        <span className="section__hint" style={{ maxWidth: 220 }}>
                          Static preview — live video plays on the Dashboard
                        </span>
                      </div>
                      <span className="cam-card__preview-tag">
                        <span className={previewBadge}>
                          <span className={previewDot} aria-hidden="true" />
                          {onlineLabel}
                        </span>
                      </span>
                      <div className="cam-card__preview-meta">
                        <span>PREVIEW</span>
                        <span>SUB {camera.subChannel}</span>
                        <span>704×576</span>
                        <span>H.264</span>
                      </div>
                    </div>

                    <div className="cam-card__body">
                      <div className="cam-card__top">
                        <div style={{ minWidth: 0 }}>
                          <div className="cam-card__chan">Channel {String(camera.id).padStart(2, "0")}</div>
                          <h2 className="cam-card__title">{camera.name}</h2>
                        </div>
                        <StatusLamp tone={deviceTone} label={onlineLabel} />
                      </div>

                      <div className="cam-card__form" style={{ flexWrap: "wrap" }}>
                        <label className="field" style={{ flex: "1 1 170px" }}>
                          <span className="field__label">Camera name</span>
                          <input
                            id={`camera-${camera.id}`}
                            value={drafts[camera.id] ?? camera.name}
                            onChange={(event) =>
                              setDrafts((current) => ({ ...current, [camera.id]: event.target.value }))
                            }
                            className="input"
                            maxLength={32}
                          />
                        </label>
                        <div style={{ display: "flex", gap: 8, marginLeft: "auto" }}>
                          <button
                            type="button"
                            onClick={() => void save(camera.id)}
                            disabled={pendingId === camera.id}
                            className="btn btn--primary"
                            style={{ height: 38, padding: "0 10px" }}
                          >
                            {pendingId === camera.id ? "Saving" : "Save"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void applyDvrName(camera.id)}
                            disabled={pendingId === camera.id}
                            className="btn"
                            style={{ height: 38, padding: "0 10px" }}
                            title="Discard the local override and show the name configured on the DVR"
                          >
                            Use DVR name
                          </button>
                        </div>
                      </div>

                      {notices[camera.id] ? (
                        <p className="field__hint" role="status">
                          {notices[camera.id]}
                        </p>
                      ) : null}

                      <dl className="cam-card__props" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                        <div className="cam-card__prop">
                          <dt>Channel</dt>
                          <dd>{String(camera.id).padStart(2, "0")}</dd>
                        </div>
                        <div className="cam-card__prop">
                          <dt>Main stream</dt>
                          <dd>{camera.mainChannel}</dd>
                        </div>
                        <div className="cam-card__prop">
                          <dt>Sub stream</dt>
                          <dd>{camera.subChannel}</dd>
                        </div>
                        <div className="cam-card__prop">
                          <dt>Stream</dt>
                          <dd>{blocked ? stream : "Ready to view"}</dd>
                        </div>
                      </dl>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>

          <aside style={{ display: "grid", gap: 16, minWidth: 0, alignContent: "start" }}>
            <section className="card">
              <div className="card__head">
                <div className="card__title">
                  <Icon name="shield" className="icon icon-sm" />
                  How the streams are used
                </div>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 14 }}>
                <div>
                  <div className="setting-row__title">
                    <Icon name="camera" className="icon icon-sm" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }} />
                    Live grid &amp; focus
                  </div>
                  <p className="setting-row__desc">
                    H.264 sub stream, 704×576. WebRTC first, same-origin HLS as the fallback.
                  </p>
                </div>
                <div>
                  <div className="setting-row__title">
                    <Icon name="playback" className="icon icon-sm" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }} />
                    Playback
                  </div>
                  <p className="setting-row__desc">
                    Recorded H.264 sub track, time-accurate to the DVR clock. One playback session at a time.
                  </p>
                </div>
                <div>
                  <div className="setting-row__title">
                    <Icon name="lock" className="icon icon-sm" style={{ display: "inline-block", verticalAlign: "-2px", marginRight: 6 }} />
                    Main stream
                  </div>
                  <p className="setting-row__desc">
                    H.265 main stream stays on the LAN and is never played in the browser.
                  </p>
                </div>
              </div>
              <div className="card__foot">
                <span className="section__hint">
                  The browser never receives a DVR address, port or credential — only same-origin WHEP/HLS through this
                  hub.
                </span>
              </div>
            </section>

            <section className="card">
              <div className="card__head">
                <div className="card__title">
                  <Icon name="file" className="icon icon-sm" />
                  Where the name comes from
                </div>
              </div>
              <div className="card__body" style={{ display: "grid", gap: 10 }}>
                <div className="status" style={{ justifyContent: "space-between" }}>
                  <span>1 · saved on this hub</span>
                  <span className="badge badge--accent">override</span>
                </div>
                <div className="status" style={{ justifyContent: "space-between" }}>
                  <span>2 · DVR channel name</span>
                  <span className="badge">ISAPI</span>
                </div>
                <div className="status" style={{ justifyContent: "space-between" }}>
                  <span>3 · generic fallback</span>
                  <span className="badge badge--mono">Camera N</span>
                </div>
                <p className="section__hint">
                  &ldquo;Use DVR name&rdquo; clears the override, so a channel renamed on the DVR follows through here.
                </p>
              </div>
            </section>
          </aside>
        </div>
      </section>
    </div>
  );
}
