"use client";

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
import { useCameraNames, cameraName } from "@/components/hooks/useCameraNames";
import { PageIntro } from "@/components/ui/States";

/**
 * Admin editor for live object detection.
 *
 * The API validates everything again, so this form is a convenience, not a
 * trust boundary. Every control has a visible label and a stable test id: the
 * Playwright suite drives this page and reloads it to prove persistence.
 */

const STATUS_TONE: Record<string, string> = {
  running: "text-online",
  starting: "text-warn",
  overloaded: "text-warn",
  error: "text-offline",
  disabled: "text-muted",
  stopped: "text-offline",
};

function percent(value: number): number {
  return Math.round(value * 100);
}

function fromPercent(value: number): number {
  return Math.min(CONFIDENCE_MAX, Math.max(CONFIDENCE_MIN, Math.round(value) / 100));
}

function Section({ title, detail, children }: { title: string; detail?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-card p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {detail ? <p className="mt-1 text-xs text-muted">{detail}</p> : null}
      <div className="mt-3 grid gap-3">{children}</div>
    </section>
  );
}

function Toggle({
  id,
  label,
  checked,
  onChange,
  disabled = false,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label htmlFor={id} className="flex items-center justify-between gap-3 text-sm">
      <span>{label}</span>
      <input
        id={id}
        data-testid={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="h-5 w-5 accent-teal"
      />
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
    <label htmlFor={id} className="grid gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <span className="flex items-center gap-2">
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
          className="h-10 w-24 rounded-lg border border-line bg-bg px-3"
        />
        {suffix ? <span className="text-xs text-muted">{suffix}</span> : null}
      </span>
    </label>
  );
}

function ConfidenceField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="grid gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <div className="flex items-center gap-3">
        <input
          id={`${id}-range`}
          data-testid={`${id}-range`}
          type="range"
          min={percent(CONFIDENCE_MIN)}
          max={percent(CONFIDENCE_MAX)}
          step={1}
          value={percent(value)}
          onChange={(event) => onChange(fromPercent(Number(event.target.value)))}
          className="h-5 flex-1 accent-teal"
          aria-label={label}
        />
        <input
          id={id}
          data-testid={id}
          type="number"
          min={percent(CONFIDENCE_MIN)}
          max={percent(CONFIDENCE_MAX)}
          step={1}
          value={percent(value)}
          onChange={(event) => onChange(fromPercent(Number(event.target.value)))}
          className="h-10 w-20 rounded-lg border border-line bg-bg px-3"
          aria-label={`${label} percentage`}
        />
        <span className="text-xs text-muted">%</span>
      </div>
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
    return <p className="text-sm text-muted">Loading detection settings…</p>;
  }
  if (!settings) {
    return (
      <div className="rounded-xl border border-line bg-card px-4 py-8 text-center" role="alert">
        <p className="text-sm">{error ?? "Detection settings are unavailable."}</p>
        <button type="button" onClick={() => void load()} className="mt-3 rounded-lg border border-line px-3 py-2 text-sm">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="grid max-w-3xl gap-4 pb-24">
      <PageIntro
        title="Object detection"
        detail="Detect people and vehicles on the camera substreams. Detection is off until you enable and save it. The DVR's own person/vehicle labels are controlled separately by the detection source below."
      />

      {error ? (
        <p className="rounded-lg border border-offline/50 bg-card px-3 py-2 text-sm text-offline" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="rounded-lg border border-online/40 bg-card px-3 py-2 text-sm text-online" role="status">
          {message}
        </p>
      ) : null}

      <Section
        title="Object detection"
        detail="Master switch. Off means the worker loads no model and analyses no frames; existing events and notifications are untouched."
      >
        <Toggle
          id="detection-enabled"
          label="Enable object detection"
          checked={settings.enabled}
          onChange={(value) => patchSettings({ enabled: value })}
        />
        <div className="rounded-lg border border-line bg-bg/40 p-3 text-sm" data-testid="detection-worker-status">
          <p className="flex flex-wrap items-center gap-2">
            <span className="text-muted">Worker</span>
            <span className={STATUS_TONE[workerStatus] ?? "text-muted"}>{workerLabel}</span>
            {worker?.updatedAt ? (
              <span className="text-xs text-muted">
                last report {new Date(worker.updatedAt).toLocaleTimeString()}
              </span>
            ) : null}
          </p>
          <p className="mt-1 text-xs text-muted">
            Model: {data?.model.name} {data?.model.version} ({data?.model.license}, ~{data?.model.sizeMb} MB).
            Cameras monitored: {monitored}. Person {percent(settings.personConfidence)}% · Vehicle{" "}
            {percent(settings.vehicleConfidence)}%.
          </p>
          {worker?.detail ? <p className="mt-1 text-xs text-warn">{worker.detail}</p> : null}
          {worker?.metrics ? (
            <p className="mt-1 text-xs text-muted">
              Inference {worker.metrics.averageInferenceMs === null ? "—" : `${Math.round(worker.metrics.averageInferenceMs)} ms`} ·
              FPS {worker.metrics.inferenceFps ?? "—"} · Queue {worker.metrics.queueDepth ?? "—"} · Dropped{" "}
              {worker.metrics.droppedFrames ?? "—"} · Today: {worker.metrics.detectionsToday ?? 0} (
              {worker.metrics.personDetectionsToday ?? 0} person, {worker.metrics.vehicleDetectionsToday ?? 0} vehicle)
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted">
            {workerStatus === "stopped"
              ? "The detection worker is not running. Start the object worker service after enabling detection."
              : "The worker applies saved changes within a few seconds; no restart is needed."}
          </p>
        </div>
      </Section>

      <Section title="Person detection" detail="Independent threshold for the person class.">
        <Toggle
          id="person-enabled"
          label="Enable person detection"
          checked={settings.personEnabled}
          onChange={(value) => patchSettings({ personEnabled: value })}
        />
        <ConfidenceField
          id="person-confidence"
          label="Global person confidence threshold"
          value={settings.personConfidence}
          onChange={(value) => patchSettings({ personConfidence: value })}
        />
      </Section>

      <Section title="Vehicle detection" detail="Independent threshold for car, motorcycle, bus and truck.">
        <Toggle
          id="vehicle-enabled"
          label="Enable vehicle detection"
          checked={settings.vehicleEnabled}
          onChange={(value) => patchSettings({ vehicleEnabled: value })}
        />
        <ConfidenceField
          id="vehicle-confidence"
          label="Global vehicle confidence threshold"
          value={settings.vehicleConfidence}
          onChange={(value) => patchSettings({ vehicleConfidence: value })}
        />
      </Section>

      <Section
        title="Camera monitoring"
        detail="Each camera can run detection independently and may override the global thresholds. A camera only runs when the master switch and its own switch are both on."
      >
        {CAMERA_IDS.map((cameraId) => {
          const camera = cameras.find((item) => item.cameraId === cameraId);
          if (!camera) return null;
          const effective = effectiveCameraDetection(settings, camera);
          return (
            <div key={cameraId} className="rounded-lg border border-line bg-bg/40 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium">{cameraName(names, cameraId)}</p>
                <span className={`text-xs ${effective.enabled ? "text-online" : "text-muted"}`}>
                  {effective.enabled
                    ? `Monitoring · person ${percent(effective.person.confidence)}% · vehicle ${percent(effective.vehicle.confidence)}%`
                    : "Not monitoring"}
                </span>
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <Toggle
                  id={`camera-${cameraId}-enabled`}
                  label="Detection"
                  checked={camera.enabled}
                  onChange={(value) => patchCamera(cameraId, { enabled: value })}
                />
                <Toggle
                  id={`camera-${cameraId}-person`}
                  label="Person"
                  checked={camera.personEnabled}
                  onChange={(value) => patchCamera(cameraId, { personEnabled: value })}
                  disabled={!camera.enabled}
                />
                <Toggle
                  id={`camera-${cameraId}-vehicle`}
                  label="Vehicle"
                  checked={camera.vehicleEnabled}
                  onChange={(value) => patchCamera(cameraId, { vehicleEnabled: value })}
                  disabled={!camera.enabled}
                />
              </div>
              {camera.enabled ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      data-testid={`camera-${cameraId}-person-global`}
                      type="checkbox"
                      checked={camera.personConfidence === null}
                      onChange={(event) =>
                        patchCamera(cameraId, {
                          personConfidence: event.target.checked ? null : settings.personConfidence,
                        })
                      }
                      className="h-4 w-4 accent-teal"
                    />
                    Person threshold: use global
                  </label>
                  {camera.personConfidence !== null ? (
                    <ConfidenceField
                      id={`camera-${cameraId}-person-confidence`}
                      label="Person threshold"
                      value={camera.personConfidence}
                      onChange={(value) => patchCamera(cameraId, { personConfidence: value })}
                    />
                  ) : null}
                  <label className="flex items-center gap-2 text-xs text-muted">
                    <input
                      data-testid={`camera-${cameraId}-vehicle-global`}
                      type="checkbox"
                      checked={camera.vehicleConfidence === null}
                      onChange={(event) =>
                        patchCamera(cameraId, {
                          vehicleConfidence: event.target.checked ? null : settings.vehicleConfidence,
                        })
                      }
                      className="h-4 w-4 accent-teal"
                    />
                    Vehicle threshold: use global
                  </label>
                  {camera.vehicleConfidence !== null ? (
                    <ConfidenceField
                      id={`camera-${cameraId}-vehicle-confidence`}
                      label="Vehicle threshold"
                      value={camera.vehicleConfidence}
                      onChange={(value) => patchCamera(cameraId, { vehicleConfidence: value })}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </Section>

      <Section title="Performance" detail="Sampling is bounded so a 2-core server is never overloaded. Frames older than the queue are dropped, never processed late.">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Base AI FPS (per camera)</span>
            <select
              id="base-fps"
              data-testid="base-fps"
              value={settings.baseFps}
              onChange={(event) => patchSettings({ baseFps: Number(event.target.value) })}
              className="h-10 rounded-lg border border-line bg-bg px-3"
            >
              {FPS_CHOICES.map((value) => (
                <option key={value} value={value}>
                  {value} FPS
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Active AI FPS</span>
            <select
              id="active-fps"
              data-testid="active-fps"
              value={settings.activeFps}
              onChange={(event) => patchSettings({ activeFps: Number(event.target.value) })}
              className="h-10 rounded-lg border border-line bg-bg px-3"
            >
              {FPS_CHOICES.map((value) => (
                <option key={value} value={value}>
                  {value} FPS
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Maximum AI FPS</span>
            <select
              id="max-fps"
              data-testid="max-fps"
              value={settings.maxFps}
              onChange={(event) => patchSettings({ maxFps: Number(event.target.value) })}
              className="h-10 rounded-lg border border-line bg-bg px-3"
            >
              {FPS_CHOICES.filter((value) => value >= settings.activeFps).map((value) => (
                <option key={value} value={value}>
                  {value} FPS
                </option>
              ))}
            </select>
          </label>
        </div>
        <Toggle
          id="motion-boost"
          label="Motion-triggered boost"
          checked={settings.motionBoost}
          onChange={(value) => patchSettings({ motionBoost: value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
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
      </Section>

      <Section title="Detection behaviour" detail="One tracked object becomes one event. A short pass-by does not create one event per frame.">
        <div className="grid gap-3 sm:grid-cols-2">
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
        <label htmlFor="detection-source" className="grid gap-1 text-sm">
          <span className="text-muted">Detection source for person/vehicle notifications</span>
          <select
            id="detection-source"
            data-testid="detection-source"
            value={settings.detectionSource}
            onChange={(event) => patchSettings({ detectionSource: event.target.value as DetectionSource })}
            className="h-10 rounded-lg border border-line bg-bg px-3"
          >
            {DETECTION_SOURCES.map((value) => (
              <option key={value} value={value}>
                {data?.detectionSources.find((source) => source.value === value)?.label ?? value}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted">
            {data?.detectionSources.find((source) => source.value === settings.detectionSource)?.description}
          </span>
        </label>
      </Section>

      <Section
        title="Diagnostics"
        detail="Run the detector once on the most recent event snapshot. The result proves what the model sees; it does not create an event or send anything."
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="detection-test-button"
            onClick={() => void runDetectionTest()}
            disabled={testPhase === "starting" || testPhase === "waiting"}
            className="h-10 rounded-lg border border-line bg-white/5 px-3 text-sm hover:bg-white/10 disabled:opacity-60"
          >
            {testPhase === "starting" || testPhase === "waiting" ? "Running test…" : "Run detection test"}
          </button>
          <span className="text-xs text-muted">
            {workerStatus === "running"
              ? "The worker is running."
              : "No worker is running: the test stays queued until it starts."}
          </span>
        </div>
        {testError ? (
          <p className="text-sm text-warn" role="alert" data-testid="detection-test-error">
            {testError}
          </p>
        ) : null}
        {testPhase === "waiting" ? (
          <p className="text-xs text-muted" data-testid="detection-test-waiting">
            Waiting for the worker to analyse the latest event snapshot…
          </p>
        ) : null}
        {testPhase === "done" && testResult && "detections" in testResult ? (
          <div className="rounded-lg border border-line bg-bg/40 p-3 text-sm" data-testid="detection-test-result">
            <p className="text-xs text-muted">
              {testResult.model} · {testResult.inferenceMs} ms · {testResult.image.width}×{testResult.image.height}
            </p>
            {testResult.detections.length === 0 ? (
              <p className="mt-1">No person or vehicle above the detector floor.</p>
            ) : (
              <ul className="mt-1 grid gap-1">
                {testResult.detections.map((detection, index) => (
                  <li key={index} className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{detection.rawClass}</span>
                    <span>{Math.round(detection.confidence * 100)}%</span>
                    <span className={detection.accepted ? "text-online" : "text-muted"}>
                      {detection.accepted ? "accepted" : "below threshold"}
                    </span>
                    <span className="font-mono text-xs text-muted">
                      {Math.round(detection.boundingBox.width)}×{Math.round(detection.boundingBox.height)} px
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="mt-1 text-xs text-muted">
              Thresholds: person {Math.round(testResult.thresholds.person * 100)}% · vehicle{" "}
              {Math.round(testResult.thresholds.vehicle * 100)}%
            </p>
          </div>
        ) : null}
      </Section>

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {settings.enabled ? "Detection is enabled." : "Detection is off."} Saved changes reach the worker within a few seconds.
          </p>
          <button
            type="button"
            data-testid="detection-save"
            onClick={() => void save()}
            disabled={saving}
            className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-black disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </div>
    </div>
  );
}
