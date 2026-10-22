"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import type { EventRuleTestResponse, NotificationRulesResponse } from "@/lib/api-types";
import { CAMERA_IDS } from "@/lib/cameras";
import { cameraName, useCameraNames } from "@/components/hooks/useCameraNames";
import { ApiError, api } from "@/lib/client-api";
import { useEscapeToDismiss } from "@/components/hooks/useEscapeToDismiss";
import {
  DEFAULT_COOLDOWN_SECONDS,
  MAX_COOLDOWN_SECONDS,
  QUIET_BEHAVIORS,
  RULE_EVENT_TYPES,
  RULE_EVENT_TYPE_LABELS,
  WEEKDAYS,
  cameraIdsFromLegacy,
  legacyRuleFields,
  ruleEventTypesFromLegacy,
  type NotificationRule,
  type QuietHoursBehavior,
  type RuleEventType,
  type Weekday,
} from "@/lib/events";
import { EVENT_PRIORITIES, type EventPriority } from "@/lib/priority";
import { Messages } from "@/lib/messages";
import { PageIntro } from "@/components/ui/States";
import { PriorityBadge } from "@/components/events/PriorityBadge";
import { TelegramTestButton } from "@/components/events/TelegramTestButton";

const RETENTION = ["7", "14", "30", "60", "90", "0"];

const BEHAVIOR_LABEL: Record<QuietHoursBehavior, string> = {
  notify: "Notify anyway",
  suppress: "Suppress the notification",
  store_only: "Store the event only",
};

function blankRule(): NotificationRule {
  return {
    id: "",
    name: "",
    enabled: true,
    cameraIds: [...CAMERA_IDS],
    eventTypes: ["person"],
    cameraId: null,
    eventType: "motion",
    classification: "person",
    minimumPriority: null,
    scheduleStart: null,
    scheduleEnd: null,
    daysOfWeek: [],
    quietHoursStart: "23:00",
    quietHoursEnd: "07:00",
    quietHoursBehavior: "suppress",
    cooldownSeconds: DEFAULT_COOLDOWN_SECONDS,
  };
}

/** Arrays are authoritative; fall back for an old rule object from any caller. */
function cameraSelection(rule: NotificationRule): number[] {
  return rule.cameraIds ?? cameraIdsFromLegacy(rule.cameraId) ?? [];
}

function eventSelection(rule: NotificationRule): RuleEventType[] {
  return rule.eventTypes ?? ruleEventTypesFromLegacy(rule.eventType, rule.classification) ?? [];
}

/** Apply a new selection and keep the legacy display/storage fields in sync. */
function withSelection(rule: NotificationRule, cameraIds: number[], eventTypes: RuleEventType[]): NotificationRule {
  return {
    ...rule,
    cameraIds,
    eventTypes,
    ...legacyRuleFields({ cameraIds, eventTypes, fallback: rule }),
  };
}

function editableRule(rule: NotificationRule): NotificationRule {
  return withSelection(rule, cameraSelection(rule), eventSelection(rule));
}

export function NotificationRules() {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [draft, setDraft] = useState<NotificationRule | null>(null);
  const [retention, setRetention] = useState("30");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [testResult, setTestResult] = useState<EventRuleTestResponse | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<NotificationRule | null>(null);
  const names = useCameraNames();
  const dismissConfirm = useCallback(() => setConfirmDelete(null), []);
  useEscapeToDismiss(confirmDelete !== null, dismissConfirm);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const body = await api<NotificationRulesResponse>("/api/notification-rules");
      setRules(body.rules);
      setRetention(RETENTION.includes(body.retentionDays) ? body.retentionDays : "30");
      setError(null);
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

  async function saveRule(rule: NotificationRule, event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    // The inline warnings beside the checkbox groups already say what is
    // missing; do not duplicate them in the page-level error banner.
    if (cameraSelection(rule).length === 0 || eventSelection(rule).length === 0) return;
    const { id: _id, ...payload } = rule;
    void _id;
    try {
      if (rule.id) {
        await api(`/api/notification-rules/${rule.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setMessage("Rule saved.");
      } else {
        await api("/api/notification-rules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        setMessage("Rule created.");
      }
      setDraft(null);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  async function toggleEnabled(rule: NotificationRule) {
    setError(null);
    try {
      await api(`/api/notification-rules/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: !rule.enabled }),
      });
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  async function remove(rule: NotificationRule) {
    setError(null);
    setMessage(null);
    setConfirmDelete(null);
    try {
      await api(`/api/notification-rules/${rule.id}`, { method: "DELETE" });
      setMessage("Rule deleted.");
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  async function saveRetention(next: string) {
    setRetention(next);
    try {
      await api("/api/notification-rules/retention", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays: next }),
      });
      setMessage("Retention saved.");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  function allowNotifications() {
    if (!("Notification" in window)) {
      setError(Messages.notificationsUnsupported);
      return;
    }
    void Notification.requestPermission().then((permission) => {
      setMessage(permission === "granted" ? Messages.notificationsGranted : Messages.notificationsDenied);
    });
  }

  return (
    <div className="min-w-0 max-w-3xl">
      <PageIntro
        title="Notification rules"
        detail="Events are always stored. A rule only decides whether the browser is notified."
      />

      <div className="mb-4 flex flex-wrap gap-2">
        <button type="button" onClick={allowNotifications} className="h-11 rounded-lg border border-line px-3 text-sm">
          {Messages.enableNotifications}
        </button>
        <button
          type="button"
          onClick={() => setDraft(blankRule())}
          className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f]"
        >
          New rule
        </button>
        {/* Server-side Telegram check. ADMIN-only page; no credentials in the browser. */}
        <TelegramTestButton />
      </div>

      {error ? <p className="mb-3 text-sm text-warn" role="alert">{error}</p> : null}
      {message ? <p className="mb-3 text-sm text-muted" role="status">{message}</p> : null}
      {loading && rules.length === 0 ? <p className="text-sm text-muted">Loading...</p> : null}

      <ul className="flex flex-col gap-2">
        {rules.map((rule) => (
          <li key={rule.id} className={`rounded-xl border px-4 py-3 ${rule.enabled ? "border-line bg-card" : "border-line bg-card/50"}`}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-semibold">{rule.name}</h2>
              {rule.minimumPriority ? <PriorityBadge priority={rule.minimumPriority} /> : null}
              <span className={`ml-auto text-xs uppercase ${rule.enabled ? "text-online" : "text-muted"}`}>
                {rule.enabled ? "Enabled" : "Disabled"}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted">
              {describeCameras(rule, names)} · {describeEvent(rule)} ·{" "}
              {rule.scheduleStart && rule.scheduleEnd ? `${rule.scheduleStart}–${rule.scheduleEnd}` : "Any time"} ·
              Cooldown {formatCooldown(rule.cooldownSeconds)}
            </p>
            <p className="mt-0.5 text-xs text-muted">
              Quiet hours {rule.quietHoursStart && rule.quietHoursEnd ? `${rule.quietHoursStart}–${rule.quietHoursEnd}` : "off"}
              {" · "}
              {BEHAVIOR_LABEL[rule.quietHoursBehavior]}
              {rule.daysOfWeek.length > 0 ? ` · ${rule.daysOfWeek.join(", ")}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <button type="button" onClick={() => void toggleEnabled(rule)} className="h-9 rounded-lg border border-line px-3 text-xs">
                {rule.enabled ? "Disable" : "Enable"}
              </button>
              <button type="button" onClick={() => setDraft(editableRule(rule))} className="h-9 rounded-lg border border-line px-3 text-xs">
                Edit
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(rule)}
                className="h-9 rounded-lg border border-line px-3 text-xs text-warn"
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>

      {confirmDelete ? (
        <div className="mt-4 rounded-xl border border-warn/50 bg-card p-4" role="alertdialog" aria-label="Confirm delete rule">
          <p className="text-sm">Delete rule <span className="font-medium">{confirmDelete.name}</span>? This cannot be undone.</p>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={() => setConfirmDelete(null)} className="h-10 rounded-lg border border-line px-4 text-sm">Cancel</button>
            <button type="button" onClick={() => void remove(confirmDelete)} className="h-10 rounded-lg bg-warn px-4 text-sm font-semibold text-black">Delete</button>
          </div>
        </div>
      ) : null}

      {draft ? (
        <RuleForm
          rule={draft}
          names={names}
          onChange={setDraft}
          onSubmit={(event) => void saveRule(draft, event)}
          onCancel={() => setDraft(null)}
        />
      ) : null}

      <section className="mt-6 rounded-xl border border-line bg-card p-4">
        <h2 className="text-sm font-semibold">Keep events</h2>
        <p className="mt-1 text-xs text-muted">
          Retention deletes this hub&apos;s own event rows, snapshots, and notification history only. It never
          deletes recordings on the DVR or MediaMTX, and never deletes user accounts.
        </p>
        <label className="mt-3 block max-w-xs text-sm">
          <span className="mb-1 block text-muted">Retention</span>
          <select
            value={retention}
            onChange={(event) => void saveRetention(event.target.value)}
            className="h-11 w-full rounded-lg border border-line bg-bg px-3"
            aria-label="Event retention"
          >
            {RETENTION.map((days) => (
              <option key={days} value={days}>
                {days === "0" ? "Forever" : `${days} days`}
              </option>
            ))}
          </select>
        </label>
      </section>

      <RuleTester names={names} onResult={setTestResult} result={testResult} />
    </div>
  );
}

function describeCameras(rule: NotificationRule, names: Record<number, string>): string {
  const ids = cameraSelection(rule);
  if (ids.length === 0) return "No cameras selected";
  if (ids.length === CAMERA_IDS.length) return "All cameras";
  return ids.map((id) => cameraName(names, id)).join(", ");
}

function describeEvent(rule: NotificationRule): string {
  const types = eventSelection(rule);
  if (types.length === 0) return "No events selected";
  return types.map((type) => RULE_EVENT_TYPE_LABELS[type]).join(", ");
}

function formatCooldown(seconds: number): string {
  if (seconds <= 0) return "none";
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds}s`;
}

function RuleForm({
  rule,
  names,
  onChange,
  onSubmit,
  onCancel,
}: {
  rule: NotificationRule;
  names: Record<number, string>;
  onChange: (rule: NotificationRule) => void;
  onSubmit: (event: FormEvent) => void;
  onCancel: () => void;
}) {
  const set = <K extends keyof NotificationRule>(key: K, value: NotificationRule[K]) =>
    onChange({ ...rule, [key]: value });

  function toggleDay(day: Weekday) {
    const next = rule.daysOfWeek.includes(day)
      ? rule.daysOfWeek.filter((item) => item !== day)
      : [...rule.daysOfWeek, day];
    set("daysOfWeek", next);
  }

  const selectedCameras = cameraSelection(rule);
  const selectedEvents = eventSelection(rule);
  const allCameras = CAMERA_IDS.every((id) => selectedCameras.includes(id));

  function toggleCamera(id: number) {
    const next = selectedCameras.includes(id)
      ? selectedCameras.filter((camera) => camera !== id)
      : [...selectedCameras, id].sort((left, right) => left - right);
    onChange(withSelection(rule, next, selectedEvents));
  }

  function toggleAllCameras() {
    onChange(withSelection(rule, allCameras ? [] : [...CAMERA_IDS], selectedEvents));
  }

  function toggleEventType(type: RuleEventType) {
    const next = selectedEvents.includes(type)
      ? selectedEvents.filter((eventType) => eventType !== type)
      : RULE_EVENT_TYPES.filter((eventType) => eventType === type || selectedEvents.includes(eventType));
    onChange(withSelection(rule, selectedCameras, next));
  }

  return (
    <form onSubmit={onSubmit} className="mt-4 space-y-3 rounded-xl border border-teal/40 bg-card p-4">
      <h2 className="text-sm font-semibold">{rule.id ? "Edit rule" : "New rule"}</h2>

      <label className="block text-sm">
        <span className="mb-1 block text-muted">Name</span>
        <input
          value={rule.name}
          onChange={(event) => set("name", event.target.value)}
          placeholder="Camera 2 Person Night Alert"
          className="h-11 w-full rounded-lg border border-line bg-bg px-3"
        />
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <fieldset className="min-w-0 text-sm">
          <legend className="mb-1 block text-muted">Camera</legend>
          <div className="max-h-48 overflow-y-auto rounded-lg border border-line bg-bg p-2">
            <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-white/5 focus-within:bg-white/5">
              <input
                type="checkbox"
                checked={allCameras}
                onChange={toggleAllCameras}
                className="h-4 w-4 shrink-0 accent-teal"
              />
              <span className="font-medium">All cameras</span>
            </label>
            <div className="my-1 border-t border-line" />
            {CAMERA_IDS.map((id) => (
              <label
                key={id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-white/5 focus-within:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={selectedCameras.includes(id)}
                  onChange={() => toggleCamera(id)}
                  className="h-4 w-4 shrink-0 accent-teal"
                />
                <span className="min-w-0 truncate">{cameraName(names, id)}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="min-w-0 text-sm">
          <legend className="mb-1 block text-muted">Event</legend>
          <div className="rounded-lg border border-line bg-bg p-2">
            {RULE_EVENT_TYPES.map((type) => (
              <label
                key={type}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1.5 hover:bg-white/5 focus-within:bg-white/5"
              >
                <input
                  type="checkbox"
                  checked={selectedEvents.includes(type)}
                  onChange={() => toggleEventType(type)}
                  className="h-4 w-4 shrink-0 accent-teal"
                />
                <span>{RULE_EVENT_TYPE_LABELS[type]}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">Motion means unclassified motion. Person and vehicle are DVR classifications.</p>
        </fieldset>
      </div>
      {selectedCameras.length === 0 ? (
        <p className="text-sm text-warn" role="alert">Select at least one camera.</p>
      ) : null}
      {selectedEvents.length === 0 ? (
        <p className="text-sm text-warn" role="alert">Select at least one event.</p>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted">Minimum priority</span>
          <select
            value={rule.minimumPriority ?? "none"}
            onChange={(event) =>
              set("minimumPriority", event.target.value === "none" ? null : (event.target.value as EventPriority))
            }
            className="h-11 w-full rounded-lg border border-line bg-bg px-3"
          >
            <option value="none">Any priority</option>
            {EVENT_PRIORITIES.map((priority) => (
              <option key={priority} value={priority}>{priority}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Active from</span>
          <input
            type="time"
            value={rule.scheduleStart ?? ""}
            onChange={(event) => set("scheduleStart", event.target.value || null)}
            className="h-11 w-full rounded-lg border border-line bg-bg px-3"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">To</span>
          <input
            type="time"
            value={rule.scheduleEnd ?? ""}
            onChange={(event) => set("scheduleEnd", event.target.value || null)}
            className="h-11 w-full rounded-lg border border-line bg-bg px-3"
          />
        </label>
      </div>
      <p className="text-xs text-muted">
        Leave both times empty for any time. A window such as 22:00–06:00 spans midnight.
      </p>

      <fieldset>
        <legend className="mb-1 text-sm text-muted">Days (none selected means every day)</legend>
        <div className="flex flex-wrap gap-2">
          {WEEKDAYS.map((day) => (
            <button
              key={day}
              type="button"
              aria-pressed={rule.daysOfWeek.includes(day)}
              onClick={() => toggleDay(day)}
              className={`h-9 rounded-lg border px-3 text-xs uppercase ${
                rule.daysOfWeek.includes(day) ? "border-teal text-teal" : "border-line text-muted"
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="text-sm">
          <span className="mb-1 block text-muted">Quiet hours from</span>
          <input
            type="time"
            value={rule.quietHoursStart ?? ""}
            onChange={(event) => set("quietHoursStart", event.target.value || null)}
            className="h-11 w-full rounded-lg border border-line bg-bg px-3"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">To</span>
          <input
            type="time"
            value={rule.quietHoursEnd ?? ""}
            onChange={(event) => set("quietHoursEnd", event.target.value || null)}
            className="h-11 w-full rounded-lg border border-line bg-bg px-3"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">During quiet hours</span>
          <select
            value={rule.quietHoursBehavior}
            onChange={(event) => set("quietHoursBehavior", event.target.value as QuietHoursBehavior)}
            className="h-11 w-full rounded-lg border border-line bg-bg px-3"
          >
            {QUIET_BEHAVIORS.map((behavior) => (
              <option key={behavior} value={behavior}>{BEHAVIOR_LABEL[behavior]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-muted">Cooldown (seconds)</span>
          <input
            type="number"
            min={0}
            max={MAX_COOLDOWN_SECONDS}
            step={30}
            value={rule.cooldownSeconds}
            onChange={(event) => set("cooldownSeconds", Number(event.target.value) || 0)}
            className="h-11 w-full rounded-lg border border-line bg-bg px-3"
          />
        </label>
        <label className="flex items-end gap-2 pb-3 text-sm">
          <input type="checkbox" checked={rule.enabled} onChange={(event) => set("enabled", event.target.checked)} />
          Enabled
        </label>
      </div>
      <p className="text-xs text-muted">
        A cooldown of {formatCooldown(rule.cooldownSeconds)} allows about one notification for this rule in that
        period, however many events arrive.
      </p>

      <div className="flex gap-2">
        <button type="submit" className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f]">
          Save rule
        </button>
        <button type="button" onClick={onCancel} className="h-11 rounded-lg border border-line px-4 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

function RuleTester({
  names,
  onResult,
  result,
}: {
  names: Record<number, string>;
  onResult: (result: EventRuleTestResponse | null) => void;
  result: EventRuleTestResponse | null;
}) {
  const [cameraId, setCameraId] = useState("2");
  const [classification, setClassification] = useState("person");
  const [time, setTime] = useState("23:30");
  const [error, setError] = useState<string | null>(null);

  async function run(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      onResult(
        await api<EventRuleTestResponse>("/api/notifications/test", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            cameraId: Number(cameraId),
            type: "motion",
            classification: classification === "none" ? null : classification,
            time,
          }),
        }),
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  return (
    <section className="mt-6 rounded-xl border border-line bg-card p-4">
      <h2 className="text-sm font-semibold">Test a rule</h2>
      <p className="mt-1 text-xs text-muted">
        Checks which rules would match an event. Nothing is stored and no notification is sent.
      </p>
      <form onSubmit={(event) => void run(event)} className="mt-3 grid gap-3 sm:grid-cols-4">
        <label className="text-sm">
          <span className="mb-1 block text-muted">Camera</span>
          <select value={cameraId} onChange={(event) => setCameraId(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-bg px-3">
            {CAMERA_IDS.map((id) => <option key={id} value={id}>{cameraName(names, id)}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Event</span>
          <select value={classification} onChange={(event) => setClassification(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-bg px-3">
            <option value="person">Person</option>
            <option value="vehicle">Vehicle</option>
            <option value="none">Unclassified motion</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Time</span>
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-bg px-3" />
        </label>
        <div className="flex items-end">
          <button type="submit" className="h-11 w-full rounded-lg border border-line px-3 text-sm">Test</button>
        </div>
      </form>
      {error ? <p className="mt-2 text-sm text-warn" role="alert">{error}</p> : null}
      {result ? (
        <div className="mt-3 rounded-lg border border-line bg-bg p-3 text-sm">
          <p>{result.message}</p>
          <p className="mt-1 text-xs text-muted">
            Effective priority {result.priority} · {result.ruleCount} rule(s) configured
          </p>
          {result.decisions.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1 text-xs">
              {result.decisions.map((decision) => (
                <li key={decision.ruleId} className="flex flex-wrap gap-2">
                  <span className="font-medium">{decision.ruleName}</span>
                  <span className={decision.notify ? "text-online" : "text-muted"}>
                    {decision.notify ? "would notify" : "would not notify"}
                  </span>
                  {decision.reason ? <span className="text-muted">{decision.reason}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}