"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DetectionSettingsResponse, DetectionTestResponse } from "@/lib/api-types";
import {
  ACTIVITY_TIMEOUT_MAX,
  ACTIVITY_TIMEOUT_MIN,
  CONFIDENCE_MAX,
  CONFIDENCE_MIN,
  DETECTION_SOURCES,
  DISAPPEARANCE_MAX,
  DISAPPEARANCE_MIN,
  FPS_CHOICES,
  MAX_CONCURRENT_MAX,
  MAX_CONCURRENT_MIN,
  MIN_DURATION_MAX,
  QUEUE_SIZE_MAX,
  QUEUE_SIZE_MIN,
  effectiveCameraDetection,
  type CameraDetectionSettings,
  type DetectionSource,
  type ObjectDetectionSettings,
} from "@/lib/object-detection";
import { CAMERA_IDS } from "@/lib/cameras";
import { ApiError, api } from "@/lib/client-api";
import { formatKolkataClock } from "@/lib/time-kolkata";
import { useCameraNames, cameraName } from "@/components/hooks/useCameraNames";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";

/**
 * Admin editor for live object detection.
 *
 * The API validates everything again, so this form is a convenience, not a
 * trust boundary. Every control has a visible label and a stable test id: the
 * Playwright suite drives this page and reloads it to prove persistence.
 *
 * Layout note: the save bar is `position: sticky` INSIDE the settings content
 * column. It is never `fixed inset-x-0`, so it can never cover the sidebar, and
 * on phones it sits above the fixed bottom navigation
 * (`bottom: 52px + safe-area inset`) instead of underneath it.
 */

type Tone = "online" | "offline" | "warn" | "idle";

const WORKER_TONE: Record<string, Tone> = {
  running: "online",
  starting: "warn",
  overloaded: "warn",
  error: "offline",
  disabled: "idle",
  stopped: "offline",
};

function badgeFor(tone: Tone): string {
  if (tone === "online") return "badge--online";
  if (tone === "offline") return "badge--danger";
  if (tone === "warn") return "badge--warn";
  return "";
}

function dotFor(tone: Tone): string {
  if (tone === "online") return "dot--online";
  if (tone === "offline") return "dot--offline";
  if (tone === "warn") return "dot--warn";
  return "dot--idle";
}

function percent(value: number): number {
  return Math.round(value * 100);
}

function fromPercent(value: number): number {
  return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, Math.round(value) / 100));
}

function SettingRow({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="setting-row max-[720px]:flex-wrap max-[720px]:items-start max-[720px]:gap-2">
      <div className="setting-row__main">
        <div className="setting-row__title">{title}</div>
        {description ? <div className="setting-row__desc">{description}</div> : null}
      </div>
      <div className="setting-row__control max-[720px]:w-full max-[720px]:justify-start">{children}</div>
    </div>
  );
}

function CheckboxToggle({
  id,
  label,
  checked,
  onChange,
  disabled = false,
  testId,
  ariaLabel,
}: {
  id: string;
  /** Visible text; pass an empty string when the surrounding row supplies the label. */
  label?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
  testId?: string;
  /** Accessible name when there is no visible label (or it must be more specific). */
  ariaLabel?: string;
}) {
  const name = ariaLabel ?? label ?? id;
  return (
    <label htmlFor={id} className="check" style={{ opacity: disabled ? 0.5 : 1 }}>
      <input
        id={id}
        data-testid={testId ?? id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        aria-label={name}
      />
      {label ? <span>{label}</span> : null}
    </label>
  );
}

function NumberField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="field">
      <span className="field__label">{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <input
          id={id}
          data-testid={id}
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(event) => {
            const parsed = Number(event.target.value);
            if (Number.isFinite(parsed)) onChange(parsed);
          }}
          className="input"
          style={{ width: 92, textAlign: "right" }}
        />
        {suffix ? <span className="section__hint">{suffix}</span> : null}
      </span>
    </label>
  );
}

function ConfidenceField({
  id,
  label,
  value,
  onChange,
  compact = false,
  disabled = false,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
  compact?: boolean;
  disabled?: boolean;
}) {
  const accessibleName = label || "Confidence threshold";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
      <input
        id={`${id}-range`}
        data-testid={`${id}-range`}
        type="range"
        min={percent(CONFIDENCE_MIN)}
        max={percent(CONFIDENCE_MAX)}
        step={1}
        value={percent(value)}
        disabled={disabled}
        onChange={(event) => onChange(fromPercent(Number(event.target.value)))}
        aria-label={accessibleName}
        style={{ width: compact ? 74 : 116, accentColor: "var(--accent)" }}
      />
      <input
        id={id}
        data-testid={id}
        type="number"
        min={percent(CONFIDENCE_MIN)}
        max={percent(CONFIDENCE_MAX)}
        step={1}
        value={percent(value)}
        disabled={disabled}
        onChange={(event) => onChange(fromPercent(Number(event.target.value)))}
        className="input"
        style={{ width: 68, textAlign: "right" }}
        aria-label={`${accessibleName} percentage`}
      />
      <span className="section__hint">%</span>
    </div>
  );
}

export function DetectionSettings() {
  const names = useCameraNames();
  const [data, setData] = useState<DetectionSettingsResponse | null>(null);
  const [settings, setSettings] = useState<ObjectDetectionSettings | null>(null);
  const [cameras, setCameras] = useState<CameraDetectionSettings[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [testPhase, setTestPhase] = useState<"idle" | "starting" | "waiting" | "done" | "error">("idle");
  const [testResult, setTestResult] = useState<DetectionTestResponse["result"]>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const body = await api<DetectionSettingsResponse>("/api/settings/detection");
      setData(body);
      setSettings(body.settings);
      setCameras(body.cameras);
      setError(null);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not load detection settings.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Deferred so the first paint is not blocked and the lint rule about
    // setting state directly inside an effect body stays satisfied.
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const worker = data?.worker ?? null;
  const workerStatus = worker?.status ?? "stopped";
  const workerTone = WORKER_TONE[workerStatus] ?? "idle";
  const workerLabel = worker
    ? workerStatus === "running"
      ? "Running"
      : workerStatus.charAt(0).toUpperCase() + workerStatus.slice(1)
    : "Not running";
  const monitored = useMemo(() => {
    if (!settings) return 0;
    return cameras.filter((camera) => effectiveCameraDetection(settings, camera).enabled).length;
  }, [settings, cameras]);

  function patchSettings(patch: Partial<ObjectDetectionSettings>) {
    setSettings((current) => (current ? { ...current, ...patch } : current));
    setMessage(null);
  }

  function patchCamera(cameraId: number, patch: Partial<CameraDetectionSettings>) {
    setCameras((current) => current.map((camera) => (camera.cameraId === cameraId ? { ...camera, ...patch } : camera)));
    setMessage(null);
  }

  /**
   * Ask the worker to analyse the most recent event snapshot. The hub queues a
   * durable request; the worker runs the model and writes the result back, so
   * the web process itself never performs inference.
   */
  async function runDetectionTest() {
    setTestPhase("starting");
    setTestResult(null);
    setTestError(null);
    try {
      const start = await api<{ id: string }>("/api/detection/test", { method: "POST" });
      setTestPhase("waiting");
      for (let attempt = 0; attempt < 20; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const body = await api<DetectionTestResponse>(`/api/detection/test/${start.id}`);
        if (body.status === "done" || body.status === "error") {
          setTestResult(body.result);
          setTestPhase(body.status === "done" ? "done" : "error");
          if (body.status === "error") setTestError("The worker could not analyse that snapshot.");
          return;
        }
      }
      setTestError("The object worker has not picked up the test yet. It runs when the worker service is running.");
      setTestPhase("error");
    } catch (cause) {
      setTestError(cause instanceof ApiError ? cause.message : "Could not run the detection test.");
      setTestPhase("error");
    }
  }

  async function save() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const body = await api<DetectionSettingsResponse>("/api/settings/detection", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings, cameras }),
      });
      setData(body);
      setSettings(body.settings);
      setCameras(body.cameras);
      setMessage("Saved. The detection worker picks this up within a few seconds.");
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : "Could not save the settings.");
    } finally {
      setSaving(false);
    }
  }

  if (loading && !data) {
    return <p className="section__hint">Loading detection settings…</p>;
  }
  if (!settings) {
    return (
      <div className="card card--pad" role="alert">
        <div className="notice notice--danger">
          <Icon name="alert" />
          <span>{error ?? "Detection settings are unavailable."}</span>
        </div>
        <button type="button" onClick={() => void load()} className="btn btn--sm" style={{ marginTop: 12 }}>
          Try again
        </button>
      </div>
    );
  }

  const lastReport = worker?.updatedAt ? formatKolkataClock(new Date(worker.updatedAt)) : "never";

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <PageHeader
        eyebrow="Administration"
        title="Object detection"
        detail="Detect people and vehicles on the camera substreams. Detection is off until you enable and save it. The DVR's own person/vehicle labels are controlled separately by the detection source below."
        actions={
          <>
            <span className={`pill${workerTone === "online" ? "" : workerTone === "idle" ? "" : " pill--warn"}`}>
              <span className={`dot ${dotFor(workerTone)}`} />
              {workerStatus === "running" ? "Worker running" : workerStatus === "stopped" ? "Worker stopped" : workerLabel}
            </span>
            <Link href="/settings/system" className="btn">
              <Icon name="activity" className="icon icon-sm" />
              System
            </Link>
          </>
        }
      />

      {error ? (
        <div className="notice notice--danger" role="alert" style={{ alignItems: "center" }}>
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      ) : null}
      {message ? (
        <div className="notice notice--accent" role="status" style={{ alignItems: "center" }}>
          <Icon name="check" />
          <span>{message}</span>
        </div>
      ) : null}

      <div className="split">
        <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <section className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="scan" className="icon icon-sm" />
                Detection
              </h2>
              <span className={`badge ${settings.enabled ? "badge--online" : ""}`}>
                {settings.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>

            <SettingRow
              title="Enable object detection"
              description="Master switch. Off means the worker loads no model and analyses no frames; existing events and notifications are untouched."
            >
              <span className="status">
                <span className={`dot ${dotFor(workerTone)}`} aria-hidden="true" />
                <span className="status__text">{workerLabel}</span>
              </span>
              <CheckboxToggle
                id="detection-enabled"
                ariaLabel="Enable object detection"
                checked={settings.enabled}
                onChange={(value) => patchSettings({ enabled: value })}
              />
            </SettingRow>

            <SettingRow
              title="Person detection"
              description="Independent threshold for the person class. A detection must reach this confidence to be stored as an event."
            >
              <ConfidenceField
                id="person-confidence"
                label="Global person confidence threshold"
                value={settings.personConfidence}
                onChange={(value) => patchSettings({ personConfidence: value })}
              />
              <CheckboxToggle
                id="person-enabled"
                ariaLabel="Enable person detection"
                checked={settings.personEnabled}
                onChange={(value) => patchSettings({ personEnabled: value })}
              />
            </SettingRow>

            <SettingRow
              title="Vehicle detection"
              description="Independent threshold for car, motorcycle, bus and truck. Same confidence rule as person detection."
            >
              <ConfidenceField
                id="vehicle-confidence"
                label="Global vehicle confidence threshold"
                value={settings.vehicleConfidence}
                onChange={(value) => patchSettings({ vehicleConfidence: value })}
              />
              <CheckboxToggle
                id="vehicle-enabled"
                ariaLabel="Enable vehicle detection"
                checked={settings.vehicleEnabled}
                onChange={(value) => patchSettings({ vehicleEnabled: value })}
              />
            </SettingRow>

            <div className="card__foot">
              <span className="section__hint">
                Thresholds apply to the local YOLOX-Nano detector. The DVR keeps its own Human / Vehicle labels.
              </span>
            </div>
          </section>

          <section className="card" style={{ minWidth: 0 }}>
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="camera" className="icon icon-sm" />
                Camera monitoring
              </h2>
              <span className="section__hint">
                {monitored} of {cameras.length || CAMERA_IDS.length} cameras · per-camera overrides
              </span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table className="table table--stack" style={{ minWidth: 760 }}>
                <thead>
                  <tr>
                    <th>Camera</th>
                    <th>Detection</th>
                    <th>Person</th>
                    <th>Vehicle</th>
                    <th>Person threshold</th>
                    <th>Vehicle threshold</th>
                  </tr>
                </thead>
                <tbody>
                  {CAMERA_IDS.map((cameraId) => {
                    const camera = cameras.find((item) => item.cameraId === cameraId);
                    if (!camera) return null;
                    const effective = effectiveCameraDetection(settings, camera);
                    const name = cameraName(names, cameraId);
                    return (
                      <tr key={cameraId}>
                        <td data-label="Camera">
                          <div style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>{name}</div>
                          <div className="section__hint" style={{ fontFamily: "var(--font-mono)", fontSize: 10 }}>
                            CH 0{cameraId} ·{" "}
                            {effective.enabled
                              ? `person ${percent(effective.person.confidence)}% · vehicle ${percent(
                                  effective.vehicle.confidence,
                                )}%`
                              : "not monitoring"}
                          </div>
                        </td>
                        <td data-label="Detection">
                          <CheckboxToggle
                            id={`camera-${cameraId}-enabled`}
                            ariaLabel={`Detection for ${name}`}
                            checked={camera.enabled}
                            onChange={(value) => patchCamera(cameraId, { enabled: value })}
                          />
                        </td>
                        <td data-label="Person">
                          <CheckboxToggle
                            id={`camera-${cameraId}-person`}
                            ariaLabel={`Person detection for ${name}`}
                            checked={camera.personEnabled}
                            onChange={(value) => patchCamera(cameraId, { personEnabled: value })}
                            disabled={!camera.enabled}
                          />
                        </td>
                        <td data-label="Vehicle">
                          <CheckboxToggle
                            id={`camera-${cameraId}-vehicle`}
                            ariaLabel={`Vehicle detection for ${name}`}
                            checked={camera.vehicleEnabled}
                            onChange={(value) => patchCamera(cameraId, { vehicleEnabled: value })}
                            disabled={!camera.enabled}
                          />
                        </td>
                        <td data-label="Person threshold">
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <label htmlFor={`camera-${cameraId}-person-global`} className="check">
                              <input
                                id={`camera-${cameraId}-person-global`}
                                data-testid={`camera-${cameraId}-person-global`}
                                type="checkbox"
                                checked={camera.personConfidence === null}
                                disabled={!camera.enabled}
                                onChange={(event) =>
                                  patchCamera(cameraId, {
                                    personConfidence: event.target.checked ? null : settings.personConfidence,
                                  })
                                }
                                aria-label={`Use the global person threshold for ${name}`}
                              />
                              <span className="section__hint">global</span>
                            </label>
                            {camera.personConfidence !== null ? (
                              <ConfidenceField
                                id={`camera-${cameraId}-person-confidence`}
                                label={`${name} person threshold`}
                                value={camera.personConfidence}
                                onChange={(value) => patchCamera(cameraId, { personConfidence: value })}
                                compact
                                disabled={!camera.enabled}
                              />
                            ) : null}
                          </div>
                        </td>
                        <td data-label="Vehicle threshold">
                          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                            <label htmlFor={`camera-${cameraId}-vehicle-global`} className="check">
                              <input
                                id={`camera-${cameraId}-vehicle-global`}
                                data-testid={`camera-${cameraId}-vehicle-global`}
                                type="checkbox"
                                checked={camera.vehicleConfidence === null}
                                disabled={!camera.enabled}
                                onChange={(event) =>
                                  patchCamera(cameraId, {
                                    vehicleConfidence: event.target.checked ? null : settings.vehicleConfidence,
                                  })
                                }
                                aria-label={`Use the global vehicle threshold for ${name}`}
                              />
                              <span className="section__hint">global</span>
                            </label>
                            {camera.vehicleConfidence !== null ? (
                              <ConfidenceField
                                id={`camera-${cameraId}-vehicle-confidence`}
                                label={`${name} vehicle threshold`}
                                value={camera.vehicleConfidence}
                                onChange={(value) => patchCamera(cameraId, { vehicleConfidence: value })}
                                compact
                                disabled={!camera.enabled}
                              />
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="card__foot">
              <span className="section__hint">
                A camera only runs when the master switch and its own switch are both on.
              </span>
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="sliders" className="icon icon-sm" />
                Performance and behaviour
              </h2>
              <span className="chip chip--mono">2-core hub</span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 14 }}>
              <div className="form-grid form-grid--3">
                <label htmlFor="base-fps" className="field">
                  <span className="field__label">Base AI FPS (per camera)</span>
                  <select
                    id="base-fps"
                    data-testid="base-fps"
                    value={settings.baseFps}
                    onChange={(event) => patchSettings({ baseFps: Number(event.target.value) })}
                    className="select"
                  >
                    {FPS_CHOICES.map((value) => (
                      <option key={value} value={value}>
                        {value} FPS
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="active-fps" className="field">
                  <span className="field__label">Active AI FPS</span>
                  <select
                    id="active-fps"
                    data-testid="active-fps"
                    value={settings.activeFps}
                    onChange={(event) => patchSettings({ activeFps: Number(event.target.value) })}
                    className="select"
                  >
                    {FPS_CHOICES.map((value) => (
                      <option key={value} value={value}>
                        {value} FPS
                      </option>
                    ))}
                  </select>
                </label>
                <label htmlFor="max-fps" className="field">
                  <span className="field__label">Maximum AI FPS</span>
                  <select
                    id="max-fps"
                    data-testid="max-fps"
                    value={settings.maxFps}
                    onChange={(event) => patchSettings({ maxFps: Number(event.target.value) })}
                    className="select"
                  >
                    {FPS_CHOICES.filter((value) => value >= settings.activeFps).map((value) => (
                      <option key={value} value={value}>
                        {value} FPS
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div style={{ display: "flex", alignItems: "center", gap: 16, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
                <div className="setting-row__main">
                  <div className="setting-row__title">Motion-triggered boost</div>
                  <div className="setting-row__desc">
                    Raises the AI rate while a track is moving, then drops back to the base rate. Sampling stays bounded so
                    the hub is never overloaded.
                  </div>
                </div>
                <CheckboxToggle
                  id="motion-boost"
                  label="Motion-triggered boost"
                  checked={settings.motionBoost}
                  onChange={(value) => patchSettings({ motionBoost: value })}
                />
              </div>

              <div className="form-grid">
                <NumberField
                  id="activity-timeout"
                  label="Activity timeout"
                  value={settings.activityTimeoutSeconds}
                  min={ACTIVITY_TIMEOUT_MIN}
                  max={ACTIVITY_TIMEOUT_MAX}
                  suffix="seconds"
                  onChange={(value) => patchSettings({ activityTimeoutSeconds: Math.round(value) })}
                  disabled={!settings.motionBoost}
                />
                <NumberField
                  id="max-concurrent"
                  label="Maximum concurrent inference"
                  value={settings.maxConcurrentInference}
                  min={MAX_CONCURRENT_MIN}
                  max={MAX_CONCURRENT_MAX}
                  onChange={(value) => patchSettings({ maxConcurrentInference: Math.round(value) })}
                />
                <NumberField
                  id="queue-size"
                  label="Inference queue size"
                  value={settings.queueSize}
                  min={QUEUE_SIZE_MIN}
                  max={QUEUE_SIZE_MAX}
                  suffix="frames"
                  onChange={(value) => patchSettings({ queueSize: Math.round(value) })}
                />
              </div>
            </div>
            <div className="card__foot">
              <span className="section__hint">
                Frames older than the queue are dropped, never processed late. No frame leaves the LAN.
              </span>
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="activity" className="icon icon-sm" />
                Detection behaviour
              </h2>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 14 }}>
              <div className="form-grid">
                <NumberField
                  id="disappearance-timeout"
                  label="Object disappearance timeout"
                  value={settings.disappearanceThresholdSeconds}
                  min={DISAPPEARANCE_MIN}
                  max={DISAPPEARANCE_MAX}
                  suffix="seconds"
                  onChange={(value) => patchSettings({ disappearanceThresholdSeconds: Math.round(value) })}
                />
                <NumberField
                  id="min-duration"
                  label="Minimum event duration"
                  value={settings.minimumEventDurationSeconds}
                  min={0}
                  max={MIN_DURATION_MAX}
                  step={0.5}
                  suffix="seconds (0 = off)"
                  onChange={(value) => patchSettings({ minimumEventDurationSeconds: value })}
                />
              </div>
              <label htmlFor="detection-source" className="field">
                <span className="field__label">Detection source for person/vehicle notifications</span>
                <select
                  id="detection-source"
                  data-testid="detection-source"
                  value={settings.detectionSource}
                  onChange={(event) => patchSettings({ detectionSource: event.target.value as DetectionSource })}
                  className="select"
                >
                  {DETECTION_SOURCES.map((value) => (
                    <option key={value} value={value}>
                      {data?.detectionSources.find((source) => source.value === value)?.label ?? value}
                    </option>
                  ))}
                </select>
                <span className="field__hint">
                  {data?.detectionSources.find((source) => source.value === settings.detectionSource)?.description}
                </span>
              </label>
            </div>
            <div className="card__foot">
              <span className="section__hint">
                One tracked object becomes one event. A short pass-by does not create one event per frame.
              </span>
            </div>
          </section>
        </div>

        <aside style={{ display: "grid", gap: 14, minWidth: 0 }}>
          <section className="card" data-testid="detection-worker-status">
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="cpu" className="icon icon-sm" />
                Worker status
              </h2>
              <span className={`badge ${badgeFor(workerTone)}`}>{workerLabel}</span>
            </div>
            <div className="card__body">
              <dl className="prop-list">
                <dt>Status</dt>
                <dd className="mono">{workerLabel}</dd>
                <dt>Model</dt>
                <dd className="mono">
                  {data?.model.name} {data?.model.version}
                </dd>
                <dt>Licence</dt>
                <dd className="mono">
                  {data?.model.license} · {data?.model.sizeMb} MB
                </dd>
                <dt>Last report</dt>
                <dd className="mono">{lastReport}</dd>
                <dt>Cameras monitored</dt>
                <dd className="mono">
                  {monitored} of {cameras.length || CAMERA_IDS.length}
                </dd>
                <dt>Thresholds</dt>
                <dd className="mono">
                  person {percent(settings.personConfidence)}% · vehicle {percent(settings.vehicleConfidence)}%
                </dd>
                {worker?.metrics ? (
                  <>
                    <dt>Inference</dt>
                    <dd className="mono">
                      {worker.metrics.averageInferenceMs === null
                        ? "—"
                        : `${Math.round(worker.metrics.averageInferenceMs)} ms`}{" "}
                      · {worker.metrics.inferenceFps ?? "—"} FPS
                    </dd>
                    <dt>Queue</dt>
                    <dd className="mono">
                      {worker.metrics.queueDepth ?? "—"} queued · {worker.metrics.droppedFrames ?? "—"} dropped
                    </dd>
                    <dt>Today</dt>
                    <dd className="mono">
                      {worker.metrics.detectionsToday ?? 0} detections · {worker.metrics.personDetectionsToday ?? 0}{" "}
                      person · {worker.metrics.vehicleDetectionsToday ?? 0} vehicle
                    </dd>
                  </>
                ) : null}
              </dl>
              {worker?.detail ? (
                <p className="section__hint" style={{ marginTop: 10, color: "var(--warn)" }}>
                  {worker.detail}
                </p>
              ) : null}
              <p className="section__hint" style={{ marginTop: 10 }}>
                {workerStatus === "stopped"
                  ? "The detection worker is not running. Start the object worker service after enabling detection."
                  : "The worker applies saved changes within a few seconds; no restart is needed."}
              </p>
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="zap" className="icon icon-sm" />
                Diagnostics
              </h2>
              <span className="chip chip--mono">Latest snapshot</span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 10 }}>
              <p className="section__hint">
                Run the detector once on the most recent event snapshot. The result proves what the model sees; it does not
                create an event or send anything.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
                <button
                  type="button"
                  data-testid="detection-test-button"
                  onClick={() => void runDetectionTest()}
                  disabled={testPhase === "starting" || testPhase === "waiting"}
                  className="btn btn--sm"
                >
                  <Icon name="zap" className="icon icon-sm" />
                  {testPhase === "starting" || testPhase === "waiting" ? "Running test…" : "Run detection test"}
                </button>
                <span className="section__hint">
                  {workerStatus === "running"
                    ? "The worker is running."
                    : "No worker is running: the test stays queued until it starts."}
                </span>
              </div>
              {testError ? (
                <p role="alert" data-testid="detection-test-error" className="notice notice--warn">
                  <Icon name="alert" />
                  <span>{testError}</span>
                </p>
              ) : null}
              {testPhase === "waiting" ? (
                <p className="section__hint" data-testid="detection-test-waiting">
                  Waiting for the worker to analyse the latest event snapshot…
                </p>
              ) : null}
              {testPhase === "done" && testResult && "detections" in testResult ? (
                <div
                  data-testid="detection-test-result"
                  style={{
                    display: "grid",
                    gap: 6,
                    border: "1px solid var(--line)",
                    borderRadius: "var(--r-md)",
                    padding: "10px 12px",
                    background: "var(--bg)",
                  }}
                >
                  <p className="section__hint">
                    {testResult.model} · {testResult.inferenceMs} ms · {testResult.image.width}×{testResult.image.height}
                  </p>
                  {testResult.detections.length === 0 ? (
                    <p style={{ fontSize: "var(--fs-12)" }}>No person or vehicle above the detector floor.</p>
                  ) : (
                    <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 4 }}>
                      {testResult.detections.map((detection, index) => (
                        <li
                          key={index}
                          style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}
                        >
                          <span style={{ fontSize: "var(--fs-12)", fontWeight: 600 }}>{detection.rawClass}</span>
                          <span className={`badge ${detection.accepted ? "badge--online" : ""}`}>
                            {Math.round(detection.confidence * 100)}%{" "}
                            {detection.accepted ? "accepted" : "below threshold"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="section__hint">
                    Thresholds: person {Math.round(testResult.thresholds.person * 100)}% · vehicle{" "}
                    {Math.round(testResult.thresholds.vehicle * 100)}%
                  </p>
                </div>
              ) : null}
            </div>
          </section>

          <section className="card">
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="info" className="icon icon-sm" />
                About this model
              </h2>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 10 }}>
              <p className="section__hint">
                Detection runs locally on the hub. No frame, snapshot or result leaves the LAN.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                <span className="chip chip--mono">CPU · 2 cores</span>
                <span className="chip chip--mono">{data?.model.name ?? "YOLOX-Nano"}</span>
                <span className="chip chip--mono">{settings.baseFps} FPS base</span>
              </div>
              <Link href="/settings/system" className="btn btn--sm btn--ghost">
                Worker health
                <Icon name="arrowRight" className="icon icon-sm" />
              </Link>
            </div>
          </section>
        </aside>
      </div>

      {/* Reserve the sticky bar's height so it can never cover the last rows. */}
      <div aria-hidden="true" style={{ height: "calc(88px + env(safe-area-inset-bottom))" }} />
      {/*
        Sticky save bar: inside the content column (never fixed), offset above the
        mobile bottom navigation so it can never be covered by it.
      */}
      <div
        className="card sticky bottom-[calc(62px+env(safe-area-inset-bottom))] min-[1025px]:bottom-0 z-20"
        style={{
          background: "var(--surface)",
          borderColor: "var(--line-2)",
          boxShadow: "0 -10px 30px rgba(0, 0, 0, 0.35)",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "12px 16px",
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
            <span className={`dot ${settings.enabled ? "dot--online" : "dot--idle"}`} aria-hidden="true" />
            <div>
              <div className="setting-row__title">{settings.enabled ? "Detection is enabled." : "Detection is off."}</div>
              <div className="section__hint">Saved changes reach the worker within a few seconds.</div>
            </div>
          </div>
          <button
            type="button"
            data-testid="detection-save"
            onClick={() => void save()}
            disabled={saving}
            className="btn btn--primary w-full sm:w-auto"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
