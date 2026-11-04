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
import { EVENT_PRIORITIES, priorityLabel, type EventPriority } from "@/lib/priority";
import { Messages } from "@/lib/messages";
import { EmptyState } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
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

/** Priority pill for a rule's minimum-priority floor (colour is never the only cue). */
function PriorityFloorBadge({ priority }: { priority: EventPriority }) {
  const tone =
    priority === "CRITICAL" ? "badge badge--critical" : priority === "HIGH" ? "badge badge--warn" : "badge";
  return <span className={tone}>{priorityLabel(priority)}</span>;
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

  const enabledCount = rules.filter((rule) => rule.enabled).length;

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Administration"
        title="Notification rules"
        detail="Events are always stored. A rule only decides whether the browser is notified."
        actions={
          <>
            <button type="button" onClick={allowNotifications} className="btn">
              <Icon name="bell" className="icon icon-sm" />
              {Messages.enableNotifications}
            </button>
            <button type="button" onClick={() => setDraft(blankRule())} className="btn btn--primary">
              <Icon name="plus" className="icon icon-sm" />
              New rule
            </button>
          </>
        }
      />

      {error ? (
        <div className="notice notice--danger" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      ) : null}
      {message ? (
        <div className="notice notice--accent" role="status">
          <Icon name="check" />
          <span>{message}</span>
        </div>
      ) : null}

      <div className="split" style={{ marginTop: 16 }}>
        <div style={{ display: "grid", gap: 16, minWidth: 0 }}>
          <section aria-labelledby="rules-title">
            <div className="section__head">
              <h2 className="section__title" id="rules-title">
                Rules
              </h2>
              <span className="section__hint">
                {rules.length} rule{rules.length === 1 ? "" : "s"} · {enabledCount} enabled
              </span>
            </div>

            {loading && rules.length === 0 ? <p className="section__hint">Loading rules…</p> : null}

            {!loading && rules.length === 0 ? (
              <EmptyState
                icon="bell"
                title="No notification rules yet."
                detail="Events are still stored. Use the New rule button above to decide when the browser is notified."
              />
            ) : null}

            <ul className="rule-list">
              {rules.map((rule) => (
                <li key={rule.id}>
                  <article className="rule" data-enabled={rule.enabled ? "true" : "false"}>
                    <div className="rule__head">
                      <span className="rule__name">{rule.name}</span>
                      {rule.minimumPriority ? <PriorityFloorBadge priority={rule.minimumPriority} /> : null}
                      <div className="rule__toggle">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={rule.enabled}
                          aria-label={`${rule.enabled ? "Disable" : "Enable"} rule ${rule.name}`}
                          onClick={() => void toggleEnabled(rule)}
                          className="switch"
                        />
                        <span>{rule.enabled ? "Enabled" : "Disabled"}</span>
                      </div>
                    </div>

                    <div className="rule__summary">
                      <span className="chip chip--teal">{describeEvent(rule)}</span>
                      <span className="chip">{describeCameras(rule, names)}</span>
                      <span className="chip chip--mono">
                        {rule.scheduleStart && rule.scheduleEnd
                          ? `${rule.scheduleStart}–${rule.scheduleEnd}`
                          : "Any time"}
                      </span>
                      <span className="chip">Cooldown {formatCooldown(rule.cooldownSeconds)}</span>
                    </div>

                    <p className="rule__detail">
                      Quiet hours{" "}
                      {rule.quietHoursStart && rule.quietHoursEnd
                        ? `${rule.quietHoursStart}–${rule.quietHoursEnd}`
                        : "off"}
                      <span className="sep">·</span>
                      {BEHAVIOR_LABEL[rule.quietHoursBehavior]}
                      {rule.daysOfWeek.length > 0 ? (
                        <>
                          <span className="sep">·</span>
                          {rule.daysOfWeek.join(", ")}
                        </>
                      ) : null}
                    </p>

                    <div className="rule__foot">
                      <button type="button" onClick={() => void toggleEnabled(rule)} className="btn btn--sm">
                        {rule.enabled ? "Disable" : "Enable"}
                      </button>
                      <button type="button" onClick={() => setDraft(editableRule(rule))} className="btn btn--sm">
                        Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmDelete(rule)}
                        className="btn btn--sm btn--danger"
                        style={{ marginLeft: "auto" }}
                      >
                        Delete
                      </button>
                    </div>
                  </article>
                </li>
              ))}
            </ul>

            {confirmDelete ? (
              <div className="card card--pad" role="alertdialog" aria-label="Confirm delete rule" style={{ marginTop: 12 }}>
                <p>
                  Delete rule <strong>{confirmDelete.name}</strong>? This cannot be undone.
                </p>
                <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                  <button type="button" onClick={() => setConfirmDelete(null)} className="btn btn--sm">
                    Cancel
                  </button>
                  <button type="button" onClick={() => void remove(confirmDelete)} className="btn btn--sm btn--danger">
                    Delete
                  </button>
                </div>
              </div>
            ) : null}
          </section>

          <section className="card">
            <div className="card__head">
              <div className="card__title">
                <Icon name="database" className="icon icon-sm" />
                Keep events
              </div>
              <span className="badge badge--mono">{retention === "0" ? "Forever" : `${retention} days`}</span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 14 }}>
              <p className="section__hint" style={{ maxWidth: "74ch" }}>
                Retention deletes this hub&apos;s own event rows, snapshots, and notification history only. It never
                deletes recordings on the DVR or MediaMTX, and never deletes user accounts.
              </p>
              <label className="field" style={{ maxWidth: 280 }}>
                <span className="field__label">Retention</span>
                <select
                  value={retention}
                  onChange={(event) => void saveRetention(event.target.value)}
                  className="select"
                  aria-label="Event retention"
                >
                  {RETENTION.map((days) => (
                    <option key={days} value={days}>
                      {days === "0" ? "Forever" : `${days} days`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <RuleTester names={names} onResult={setTestResult} result={testResult} />
        </div>

        <div style={{ display: "grid", gap: 16, minWidth: 0, alignContent: "start" }}>
          {draft ? (
            <RuleForm
              rule={draft}
              names={names}
              onChange={setDraft}
              onSubmit={(event) => void saveRule(draft, event)}
              onCancel={() => setDraft(null)}
            />
          ) : (
            <section className="card card--pad">
              <div className="card__title" style={{ marginBottom: 6 }}>
                <Icon name="sliders" className="icon icon-sm" />
                Rule editor
              </div>
              <p className="section__hint">
                Select <strong>Edit</strong> on a rule, or use the New rule button above to shape its camera and event
                scope, active window, quiet hours and cooldown.
              </p>
            </section>
          )}

          <section className="card" aria-labelledby="telegram-title">
            <div className="card__head">
              <div className="card__title" id="telegram-title">
                <Icon name="send" className="icon icon-sm" />
                Telegram
              </div>
            </div>
            <div className="card__body">
              {/* Server-side Telegram check. ADMIN-only page; no credentials in the browser. */}
              <TelegramTestButton />
            </div>
          </section>
        </div>
      </div>
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
    <form onSubmit={onSubmit} className="rule-editor">
      <div className="rule-editor__head">
        <div className="card__title">{rule.id ? "Edit rule" : "New rule"}</div>
        <span className="badge badge--accent">{rule.id ? "Editing" : "Draft"}</span>
      </div>

      <div className="rule-editor__body">
        <label className="field" htmlFor="rule-name">
          <span className="field__label">Name</span>
          <input
            id="rule-name"
            value={rule.name}
            onChange={(event) => set("name", event.target.value)}
            placeholder="Camera 2 Person Night Alert"
            className="input"
            autoComplete="off"
          />
        </label>

        <div className="field" role="group" aria-label="Camera">
          <span className="field__label">Camera</span>
          <div className="check-card" style={{ maxHeight: "none" }}>
            <label className="check">
              <input type="checkbox" checked={allCameras} onChange={toggleAllCameras} />
              All cameras
            </label>
            <div style={{ height: 1, background: "var(--line)", margin: "3px 2px" }} />
            {CAMERA_IDS.map((id) => (
              <label key={id} className="check" title={cameraName(names, id)}>
                <input type="checkbox" checked={selectedCameras.includes(id)} onChange={() => toggleCamera(id)} />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {cameraName(names, id)}
                </span>
              </label>
            ))}
          </div>
        </div>

        <div className="field" role="group" aria-label="Event">
          <span className="field__label">Event</span>
          <div className="check-card">
            {RULE_EVENT_TYPES.map((type) => (
              <label key={type} className="check">
                <input type="checkbox" checked={selectedEvents.includes(type)} onChange={() => toggleEventType(type)} />
                {RULE_EVENT_TYPE_LABELS[type]}
              </label>
            ))}
            <p className="field__hint" style={{ padding: "6px 4px 2px" }}>
              Motion means unclassified motion. Person and vehicle are DVR classifications.
            </p>
          </div>
        </div>

        {selectedCameras.length === 0 ? (
          <p className="field__hint" role="alert" style={{ color: "var(--warn)" }}>
            Select at least one camera.
          </p>
        ) : null}
        {selectedEvents.length === 0 ? (
          <p className="field__hint" role="alert" style={{ color: "var(--warn)" }}>
            Select at least one event.
          </p>
        ) : null}

        <div className="form-grid form-grid--3">
          <label className="field" htmlFor="rule-priority">
            <span className="field__label">Minimum priority</span>
            <select
              id="rule-priority"
              value={rule.minimumPriority ?? "none"}
              onChange={(event) =>
                set("minimumPriority", event.target.value === "none" ? null : (event.target.value as EventPriority))
              }
              className="select"
            >
              <option value="none">Any priority</option>
              {EVENT_PRIORITIES.map((priority) => (
                <option key={priority} value={priority}>
                  {priority}
                </option>
              ))}
            </select>
          </label>
          <label className="field" htmlFor="rule-from">
            <span className="field__label">Active from</span>
            <input
              id="rule-from"
              type="time"
              value={rule.scheduleStart ?? ""}
              onChange={(event) => set("scheduleStart", event.target.value || null)}
              className="input input--mono"
            />
          </label>
          <label className="field" htmlFor="rule-to">
            <span className="field__label">To</span>
            <input
              id="rule-to"
              type="time"
              value={rule.scheduleEnd ?? ""}
              onChange={(event) => set("scheduleEnd", event.target.value || null)}
              className="input input--mono"
            />
          </label>
        </div>
        <p className="field__hint">Leave both times empty for any time. A window such as 22:00–06:00 spans midnight.</p>

        <div className="field">
          <span className="field__label">Days (none selected means every day)</span>
          <div className="day-row">
            {WEEKDAYS.map((day) => (
              <button
                key={day}
                type="button"
                aria-pressed={rule.daysOfWeek.includes(day)}
                onClick={() => toggleDay(day)}
                className="day"
              >
                {day.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div className="form-grid form-grid--3">
          <label className="field" htmlFor="quiet-from">
            <span className="field__label">Quiet hours from</span>
            <input
              id="quiet-from"
              type="time"
              value={rule.quietHoursStart ?? ""}
              onChange={(event) => set("quietHoursStart", event.target.value || null)}
              className="input input--mono"
            />
          </label>
          <label className="field" htmlFor="quiet-to">
            <span className="field__label">To</span>
            <input
              id="quiet-to"
              type="time"
              value={rule.quietHoursEnd ?? ""}
              onChange={(event) => set("quietHoursEnd", event.target.value || null)}
              className="input input--mono"
            />
          </label>
          <label className="field" htmlFor="quiet-behaviour">
            <span className="field__label">During quiet hours</span>
            <select
              id="quiet-behaviour"
              value={rule.quietHoursBehavior}
              onChange={(event) => set("quietHoursBehavior", event.target.value as QuietHoursBehavior)}
              className="select"
            >
              {QUIET_BEHAVIORS.map((behavior) => (
                <option key={behavior} value={behavior}>
                  {BEHAVIOR_LABEL[behavior]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="form-grid">
          <label className="field" htmlFor="rule-cooldown">
            <span className="field__label">Cooldown (seconds)</span>
            <input
              id="rule-cooldown"
              type="number"
              min={0}
              max={MAX_COOLDOWN_SECONDS}
              step={30}
              value={rule.cooldownSeconds}
              onChange={(event) => set("cooldownSeconds", Number(event.target.value) || 0)}
              className="input input--mono"
            />
          </label>
          <label className="check" style={{ alignSelf: "end", height: 38 }}>
            <input type="checkbox" checked={rule.enabled} onChange={(event) => set("enabled", event.target.checked)} />
            Enabled
          </label>
        </div>
        <p className="field__hint">
          A cooldown of {formatCooldown(rule.cooldownSeconds)} allows about one notification for this rule in that
          period, however many events arrive.
        </p>

        <div style={{ display: "flex", gap: 8, borderTop: "1px solid var(--line)", paddingTop: 14 }}>
          <button type="submit" className="btn btn--primary">
            Save rule
          </button>
          <button type="button" onClick={onCancel} className="btn btn--ghost">
            Cancel
          </button>
        </div>
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
    <section className="card">
      <div className="card__head">
        <div className="card__title">
          <Icon name="zap" className="icon icon-sm" />
          Test a rule
        </div>
        <span className="section__hint">Dry run — nothing is stored</span>
      </div>
      <div className="card__body" style={{ display: "grid", gap: 12 }}>
        <p className="section__hint" style={{ maxWidth: "74ch" }}>
          Checks which rules would match an event. Nothing is stored and no notification is sent.
        </p>
        <form onSubmit={(event) => void run(event)} style={{ display: "grid", gap: 12 }}>
          <div className="form-grid form-grid--3">
            <label className="field" htmlFor="test-camera">
              <span className="field__label">Camera</span>
              <select
                id="test-camera"
                value={cameraId}
                onChange={(event) => setCameraId(event.target.value)}
                className="select"
              >
                {CAMERA_IDS.map((id) => (
                  <option key={id} value={id}>
                    {cameraName(names, id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field" htmlFor="test-event">
              <span className="field__label">Event</span>
              <select
                id="test-event"
                value={classification}
                onChange={(event) => setClassification(event.target.value)}
                className="select"
              >
                <option value="person">Person</option>
                <option value="vehicle">Vehicle</option>
                <option value="none">Unclassified motion</option>
              </select>
            </label>
            <label className="field" htmlFor="test-time">
              <span className="field__label">Time</span>
              <input
                id="test-time"
                type="time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                className="input input--mono"
              />
            </label>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
            <button type="submit" className="btn">
              Test
            </button>
            <span className="section__hint">Uses today&apos;s date, India time</span>
          </div>
        </form>

        {error ? (
          <div className="notice notice--danger" role="alert">
            <Icon name="alert" />
            <span>{error}</span>
          </div>
        ) : null}

        {result ? (
          <div className="notice notice--accent">
            <Icon name="check" />
            <div>
              <p>{result.message}</p>
              <p className="section__hint" style={{ marginTop: 4 }}>
                Effective priority {result.priority} · {result.ruleCount} rule(s) configured
              </p>
              {result.decisions.length > 0 ? (
                <ul style={{ marginTop: 8, display: "grid", gap: 4 }}>
                  {result.decisions.map((decision) => (
                    <li key={decision.ruleId} style={{ fontSize: "var(--fs-12)", display: "flex", flexWrap: "wrap", gap: 8 }}>
                      <strong>{decision.ruleName}</strong>
                      <span style={{ color: decision.notify ? "var(--online)" : "var(--muted)" }}>
                        {decision.notify ? "would notify" : "would not notify"}
                      </span>
                      {decision.reason ? <span style={{ color: "var(--muted)" }}>{decision.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}
