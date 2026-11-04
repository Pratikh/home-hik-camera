"use client";

import Link from "next/link";
import type { GatewayState, SettingsResponse } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { usePoll } from "@/components/hooks/usePoll";
import { ErrorBanner } from "@/components/ui/States";
import { Icon, type IconName } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";

function gatewayLabel(state: GatewayState): string {
  return state === "connected" ? Messages.gatewayUp : Messages.gatewayDown;
}

function toneForBadge(tone: "online" | "offline" | "warn" | "idle"): string {
  if (tone === "online") return "badge--online";
  if (tone === "offline") return "badge--danger";
  if (tone === "warn") return "badge--warn";
  return "";
}

function dotFor(tone: "online" | "offline" | "warn" | "idle"): string {
  if (tone === "online") return "dot--online";
  if (tone === "offline") return "dot--offline";
  if (tone === "warn") return "dot--warn";
  return "dot--idle";
}

type ManageLink = { href: string; label: string; description: string; icon: IconName };

const MANAGE_LINKS: ManageLink[] = [
  { href: "/settings/users", label: "Users", description: "Accounts, roles and sessions", icon: "users" },
  {
    href: "/settings/notifications",
    label: "Notification rules",
    description: "Conditions, quiet hours and cooldowns",
    icon: "bell",
  },
  {
    href: "/settings/detection",
    label: "Object detection",
    description: "Worker, thresholds and per-camera overrides",
    icon: "scan",
  },
  { href: "/settings/audit-log", label: "Audit log", description: "Sign-ins and account changes", icon: "file" },
  {
    href: "/settings/system",
    label: "System",
    description: "Health, MediaMTX paths and active sessions",
    icon: "activity",
  },
  { href: "/account", label: "Account", description: "Your password and signed-in sessions", icon: "user" },
];

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

  const dvrTone: "online" | "offline" | "warn" | "idle" = !data
    ? "idle"
    : data.dvr === "connected"
      ? "online"
      : data.dvr === "disconnected"
        ? "offline"
        : "warn";
  const gatewayTone: "online" | "offline" | "warn" | "idle" = !data
    ? "idle"
    : data.videoGateway === "connected"
      ? "online"
      : "offline";
  const allHealthy = dvrTone === "online" && gatewayTone === "online" && !error;

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <PageHeader
        eyebrow="Administration"
        title="Settings"
        detail="Read-only view of the server environment. Change values in the .env file, then restart the hub."
        actions={
          <>
            <span className={`pill${!data ? "" : allHealthy ? "" : " pill--warn"}`}>
              <span className={`dot ${!data ? "dot--idle" : allHealthy ? "dot--online" : "dot--warn"}`} />
              {!data ? Messages.checking : allHealthy ? "All checks passing" : "Needs attention"}
            </span>
            <Link href="/settings/system" className="btn">
              <Icon name="activity" className="icon icon-sm" />
              System health
            </Link>
          </>
        }
      />

      {loading && !data ? (
        <div aria-hidden="true" className="health-grid">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="skeleton" style={{ height: 74 }} />
          ))}
        </div>
      ) : null}
      {error && !data ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}

      {data ? (
        <>
          <div className="health-grid">
            <div className="health-card">
              <div className="health-card__head">
                <Icon name="database" className="icon icon-sm" />
                Backend:
                <span className={`dot ${dotFor("online")}`} />
              </div>
              <div className="health-card__value">
                <span className={`badge ${toneForBadge("online")}`}>{data.backend}</span> · the hub answered this request
              </div>
            </div>
            <div className="health-card">
              <div className="health-card__head">
                <Icon name="device" className="icon icon-sm" />
                DVR:
                <span className={`dot ${dotFor(dvrTone)}`} />
              </div>
              <div className="health-card__value">
                <span className={`badge ${toneForBadge(dvrTone)}`}>{data.dvrMessage}</span>
                {data.dvrHost ? ` · ${data.dvrHost}:${data.dvrHttpPort}` : " · host not configured"}
              </div>
            </div>
            <div className="health-card">
              <div className="health-card__head">
                <Icon name="wifi" className="icon icon-sm" />
                Video gateway:
                <span className={`dot ${dotFor(gatewayTone)}`} />
              </div>
              <div className="health-card__value">
                <span className={`badge ${toneForBadge(gatewayTone)}`}>{gatewayLabel(data.videoGateway)}</span> ·
                WebRTC via MediaMTX
              </div>
            </div>
          </div>

          <div className="notice notice--accent">
            <Icon name="lock" />
            <div>
              <strong>Read-only.</strong> These values come from the server&apos;s <code>.env</code> file at boot and are
              never written back by the hub. Change the file, then restart the hub. The DVR password is held
              server-side and is only ever shown masked.
            </div>
          </div>

          <section className="card" style={{ minWidth: 0 }}>
            <div className="card__head">
              <h2 className="card__title">
                <Icon name="settings" className="icon icon-sm" />
                Environment
              </h2>
              <span className="chip chip--mono">.env</span>
            </div>
            <div className="card__body">
              <dl className="kv-grid">
                {rows.map(([label, value], index) => {
                  const fullWidth = index === rows.length - 1 && rows.length % 2 === 1;
                  return (
                    <div key={label} className="kv" style={fullWidth ? { gridColumn: "1 / -1" } : undefined}>
                      <dt>{label}</dt>
                      <dd className="mono" aria-label={label === "Password" ? "Password hidden" : undefined}>
                        {value}
                        {label === "Video placeholder" && value === "Off" ? (
                          <span className="section__hint">
                            {" "}
                            — development-only fallback for the video gateway, disabled on this hub.
                          </span>
                        ) : null}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            </div>
            <div
              className="card__foot"
              style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
            >
              <span className="section__hint">DVR credentials stay on the hub; the browser never receives them.</span>
              <Link href="/settings/system" className="btn btn--sm btn--ghost">
                Open diagnostics
                <Icon name="arrowRight" className="icon icon-sm" />
              </Link>
            </div>
          </section>

          <div>
            <div className="section__head">
              <div className="section__title">Manage</div>
              <span className="section__hint">Administration · {MANAGE_LINKS.length} destinations</span>
            </div>
            <div className="link-cards">
              {MANAGE_LINKS.map((item) => (
                <Link key={item.href} href={item.href} className="link-card">
                  <span className="link-card__icon">
                    <Icon name={item.icon} className="icon icon-sm" />
                  </span>
                  <span style={{ display: "grid", gap: 1, minWidth: 0 }}>
                    <span className="link-card__title">{item.label}</span>
                    <span className="link-card__desc">{item.description}</span>
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
