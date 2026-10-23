"use client";

import Link from "next/link";
import type { GatewayState, SettingsResponse } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { usePoll } from "@/components/hooks/usePoll";
import { ErrorBanner, PageIntro } from "@/components/ui/States";
import { StatusLamp } from "@/components/ui/StatusLamp";

function gatewayLabel(state: GatewayState): string {
  return state === "connected" ? Messages.gatewayUp : Messages.gatewayDown;
}

export function SettingsView() {
  const { data, error, loading, reload } = usePoll<SettingsResponse>("/api/settings");

  const rows = data
    ? [
        ["DVR host", data.dvrHost || Messages.notReported],
        ["HTTP port", String(data.dvrHttpPort)],
        ["RTSP port", String(data.dvrRtspPort)],
        ["Username", data.dvrUsername || Messages.notReported],
        ["Password", data.dvrPasswordMask],
        ["WebRTC host", data.webrtcAdditionalHost || Messages.notReported],
        ["Video placeholder", data.videoDevPlaceholder ? "On" : "Off"],
      ]
    : [];

  return (
    <section>
      <PageIntro
        title="Settings"
        detail="Read-only view of the server environment. Change values in the .env file, then restart the hub."
      />
      <p className="mb-4 text-sm">
        <Link href="/settings/users" className="text-teal">Users</Link>
        <span className="text-muted"> · </span>
        <Link href="/settings/notifications" className="text-teal">Notification rules</Link>
        <span className="text-muted"> · </span>
        <Link href="/settings/detection" className="text-teal">Object detection</Link>
        <span className="text-muted"> · </span>
        <Link href="/settings/audit-log" className="text-teal">Audit log</Link>
        <span className="text-muted"> · </span>
        <Link href="/settings/system" className="text-teal">System</Link>
      </p>
      {loading && !data ? <p className="text-sm text-muted">{Messages.checking}</p> : null}
      {error && !data ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}
      {data ? (
        <div className="grid gap-4">
          <div className="grid gap-3 rounded-xl border border-line bg-card p-4 sm:grid-cols-3">
            <StatusLamp tone="online" label={`Backend ${data.backend}`} />
            <StatusLamp
              tone={data.dvr === "connected" ? "online" : data.dvr === "disconnected" ? "offline" : "warn"}
              label={data.dvrMessage}
            />
            <StatusLamp
              tone={data.videoGateway === "connected" ? "online" : "offline"}
              label={gatewayLabel(data.videoGateway)}
            />
          </div>
          <dl className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2">
            {rows.map(([label, value], index) => (
              <div
                key={label}
                className={`min-w-0 bg-card px-4 py-3 ${index === rows.length - 1 && rows.length % 2 === 1 ? "sm:col-span-2" : ""}`}
              >
                <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
                <dd className="mt-1 break-all font-mono text-sm" aria-label={label === "Password" ? "Password hidden" : undefined}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}
    </section>
  );
}
