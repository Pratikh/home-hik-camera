"use client";

import { useEffect, useState } from "react";
import type { TelegramMediaStatusResponse } from "@/lib/api-types";
import { api } from "@/lib/client-api";

type Phase = "idle" | "sending" | "success" | "failure";

/**
 * Sends one Telegram test message through the authenticated, ADMIN-only
 * endpoint, and shows a read-only summary of the Telegram media settings.
 *
 * The browser never sees the bot token or the chat id: the request carries no
 * credentials, and the status response contains booleans and durations only.
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
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void send()}
          disabled={phase === "sending"}
          className="h-11 rounded-lg border border-line px-3 text-sm hover:bg-white/5 disabled:opacity-60"
        >
          {phase === "sending" ? "Sending…" : "Send Telegram Test"}
        </button>
        {message ? (
          <span
            role={phase === "failure" ? "alert" : "status"}
            className={`text-sm ${phase === "failure" ? "text-warn" : "text-muted"}`}
          >
            {message}
          </span>
        ) : null}
      </div>

      {status ? (
        <p className="text-xs text-muted" data-testid="telegram-status">
          Telegram: <span className={on ? "text-online" : ""}>{on ? "Enabled" : "Disabled"}</span>
          {" · "}Rule events: {status.eventNotifications && on ? "On" : "Off"}
          {" · "}Snapshot: {status.faceImage && on ? "On" : "Off"}
          {" · "}Video:{" "}
          {status.faceVideo && on ? `On (${status.clipSeconds}s, ${status.videoPreSeconds}s before)` : "Off"}
          {status.faceVideo && on ? ` · FFmpeg: ${status.ffmpeg === "available" ? "found" : "not found"}` : ""}
        </p>
      ) : null}
    </div>
  );
}
