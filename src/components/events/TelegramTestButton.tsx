"use client";

import { useEffect, useState } from "react";
import type { TelegramMediaStatusResponse } from "@/lib/api-types";
import { api } from "@/lib/client-api";
import { Icon } from "@/components/ui/Icon";

type Phase = "idle" | "sending" | "success" | "failure";

/**
 * Sends one Telegram test message through the authenticated, ADMIN-only
 * endpoint, and shows a read-only summary of the Telegram media settings.
 *
 * The browser never sees the bot token or the chat id: the request carries no
 * credentials, and the status response contains booleans and durations only.
 *
 * The exact status sentence is asserted by `telegram.spec.ts` via
 * `data-testid="telegram-status"` (Telegram: / Enabled / Snapshot: On /
 * Video: On (10s, 5s before) / FFmpeg: found). Do not reword it.
 */
export function TelegramTestButton() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<TelegramMediaStatusResponse | null>(null);

  useEffect(() => {
    void api<TelegramMediaStatusResponse>("/api/notifications/telegram/status")
      .then(setStatus)
      .catch(() => undefined);
  }, []);

  async function send() {
    setPhase("sending");
    setMessage(null);
    try {
      const body = await api<{ ok: boolean; message?: string }>("/api/notifications/telegram/test", {
        method: "POST",
      });
      setPhase("success");
      setMessage(body.message ?? "Telegram test message sent.");
    } catch (error) {
      setPhase("failure");
      setMessage(error instanceof Error ? error.message : "Telegram test failed.");
    }
  }

  const on = status ? status.enabled && status.configured : false;

  return (
    <div style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10 }}>
        <button type="button" onClick={() => void send()} disabled={phase === "sending"} className="btn">
          <Icon name="send" className="icon icon-sm" />
          {phase === "sending" ? "Sending…" : "Send Telegram Test"}
        </button>
        {message ? (
          <p
            role={phase === "failure" ? "alert" : "status"}
            className={phase === "failure" ? "notice notice--danger" : "section__hint"}
            style={{ margin: 0 }}
          >
            {message}
          </p>
        ) : null}
      </div>

      {status ? (
        <p
          className="section__hint"
          data-testid="telegram-status"
          style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: "var(--fs-11)", lineHeight: 1.6 }}
        >
          Telegram: <span className={on ? "text-online" : undefined}>{on ? "Enabled" : "Disabled"}</span>
          {" · "}Rule events: {status.eventNotifications && on ? "On" : "Off"}
          {" · "}Snapshot: {status.eventImage && on ? "On" : "Off"}
          {" · "}Video:{" "}
          {status.eventVideo && on ? `On (${status.clipSeconds}s, ${status.videoPreSeconds}s before)` : "Off"}
          {status.eventVideo && on ? ` · FFmpeg: ${status.ffmpeg === "available" ? "found" : "not found"}` : ""}
        </p>
      ) : null}
    </div>
  );
}
