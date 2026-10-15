"use client";

import { useEffect, useState } from "react";
import type { CamerasResponse } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { ErrorBanner, PageIntro } from "@/components/ui/States";
import { StatusLamp } from "@/components/ui/StatusLamp";

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

  return (
    <section>
      <PageIntro
        title="Camera setup"
        detail="Names come from the DVR channel configuration. Saving a name here overrides it on this hub only; the DVR keeps its own name."
      />
      {error && !data ? <ErrorBanner message={error} onRetry={() => void load()} /> : null}
      {data ? (
        <div className="mb-4">
          <StatusLamp
            tone={data.dvr === "connected" ? "online" : data.dvr === "disconnected" ? "offline" : "warn"}
            label={data.dvrMessage}
          />
        </div>
      ) : null}
      <div className="grid gap-3">
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
          return (
            <article key={camera.id} className="rounded-xl border border-line bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <label className="text-xs uppercase tracking-wide text-muted" htmlFor={`camera-${camera.id}`}>
                    Channel {camera.id}
                  </label>
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                    <input
                      id={`camera-${camera.id}`}
                      value={drafts[camera.id] ?? camera.name}
                      onChange={(event) => setDrafts((current) => ({ ...current, [camera.id]: event.target.value }))}
                      className="w-full min-w-0 rounded-lg border border-line bg-bg px-3 py-2 text-sm"
                      maxLength={32}
                    />
                    <button
                      type="button"
                      onClick={() => void save(camera.id)}
                      disabled={pendingId === camera.id}
                      className="rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-black disabled:opacity-60"
                    >
                      {pendingId === camera.id ? "Saving" : "Save"}
                    </button>
                    <button
                      type="button"
                      onClick={() => void applyDvrName(camera.id)}
                      disabled={pendingId === camera.id}
                      className="rounded-lg border border-line px-4 py-2 text-sm disabled:opacity-60"
                      title="Discard the local override and show the name configured on the DVR"
                    >
                      Use DVR name
                    </button>
                  </div>
                  {notices[camera.id] ? <p className="mt-2 text-xs text-muted">{notices[camera.id]}</p> : null}
                </div>
                <StatusLamp
                  tone={camera.online === true ? "online" : camera.online === false ? "offline" : "warn"}
                  label={camera.online === true ? Messages.online : camera.online === false ? Messages.offline : Messages.notReported}
                />
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                <div>
                  <dt className="text-xs text-muted">Channel</dt>
                  <dd className="font-mono">{camera.id}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Main stream</dt>
                  <dd className="font-mono">{camera.mainChannel}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Sub stream</dt>
                  <dd className="font-mono">{camera.subChannel}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Stream</dt>
                  <dd>{blocked ? stream : "Ready to view"}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}
