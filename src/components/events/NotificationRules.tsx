"use client";

import { FormEvent, useEffect, useState } from "react";
import type { NotificationRule } from "@/lib/events";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { PageIntro } from "@/components/ui/States";

type RulesResponse = { rules: NotificationRule[]; retentionDays: string };

const RETENTION = ["7", "14", "30", "60", "90", "0"];

function label(rule: NotificationRule): string {
  if (rule.classification === "person") return "Person detected";
  if (rule.classification === "vehicle") return "Vehicle detected";
  return "Motion detected";
}

export function NotificationRules() {
  const [rules, setRules] = useState<NotificationRule[]>([]);
  const [camera, setCamera] = useState("all");
  const [quietStart, setQuietStart] = useState("23:00");
  const [quietEnd, setQuietEnd] = useState("07:00");
  const [retention, setRetention] = useState("30");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<RulesResponse>("/api/notification-rules")
      .then((body) => {
        setRules(body.rules);
        setRetention(RETENTION.includes(body.retentionDays) ? body.retentionDays : "30");
        const first = body.rules[0];
        if (!first) return;
        setCamera(first.cameraId ? String(first.cameraId) : "all");
        setQuietStart(first.quietHoursStart ?? "23:00");
        setQuietEnd(first.quietHoursEnd ?? "07:00");
      })
      .catch((caught: unknown) => {
        if (caught instanceof ApiError && caught.status === 401) return;
        setError(caught instanceof Error ? caught.message : Messages.backendDown);
      });
  }, []);

  function toggle(id: string) {
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, enabled: !rule.enabled } : rule)));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    const cameraId = camera === "all" ? null : Number(camera);
    try {
      for (const rule of rules) {
        await api(`/api/notification-rules/${rule.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...rule,
            cameraId,
            quietHoursStart: quietStart,
            quietHoursEnd: quietEnd,
          }),
        });
      }
      await api("/api/notification-rules/rule-person", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays: retention }),
      });
      setMessage("Notification rules saved.");
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  function allowNotifications() {
    if (!("Notification" in window)) {
      setError("This browser does not support notifications.");
      return;
    }
    void Notification.requestPermission().then((permission) => {
      setMessage(permission === "granted" ? "CCTV notifications allowed." : "Notifications were not allowed.");
    });
  }

  return (
    <div className="min-w-0">
      <PageIntro title="Notification rules" detail="Events are always stored. Quiet hours only stop browser notifications." />
      <form onSubmit={(event) => void save(event)} className="max-w-xl space-y-4 rounded-xl border border-line bg-card p-4">
        <button type="button" onClick={allowNotifications} className="h-11 rounded-lg border border-line px-3 text-sm">
          Allow CCTV notifications?
        </button>
        <fieldset className="space-y-2">
          <legend className="text-sm text-muted">Notify for</legend>
          {rules.map((rule) => (
            <label key={rule.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={rule.enabled} onChange={() => toggle(rule.id)} />
              {label(rule)}
            </label>
          ))}
        </fieldset>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Camera</span>
          <select value={camera} onChange={(event) => setCamera(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-bg px-3" aria-label="Notification camera">
            <option value="all">All cameras</option>
            <option value="1">Camera 1</option>
            <option value="2">Camera 2</option>
            <option value="3">Camera 3</option>
            <option value="4">Camera 4</option>
          </select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-muted">Quiet hours from</span>
            <input type="time" value={quietStart} onChange={(event) => setQuietStart(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-bg px-3" aria-label="Quiet hours start" />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-muted">To</span>
            <input type="time" value={quietEnd} onChange={(event) => setQuietEnd(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-bg px-3" aria-label="Quiet hours end" />
          </label>
        </div>
        <label className="block text-sm">
          <span className="mb-1 block text-muted">Keep events</span>
          <select value={retention} onChange={(event) => setRetention(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-bg px-3" aria-label="Event retention">
            <option value="7">7 days</option>
            <option value="14">14 days</option>
            <option value="30">30 days</option>
            <option value="60">60 days</option>
            <option value="90">90 days</option>
            <option value="0">Forever</option>
          </select>
        </label>
        {error ? <p className="text-sm text-warn" role="alert">{error}</p> : null}
        {message ? <p className="text-sm text-muted" role="status">{message}</p> : null}
        <button type="submit" className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f]">Save</button>
      </form>
    </div>
  );
}
