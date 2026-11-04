"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DvrStatusResponse } from "@/lib/api-types";
import { api, navigate } from "@/lib/client-api";
import { eventTitle, type CctvEvent } from "@/lib/events";
import { faceNotificationOptions, type LiveFaceNotification } from "@/lib/faces";
import { Messages } from "@/lib/messages";
import { formatKolkataClock, formatKolkataDate, todayInKolkata } from "@/lib/time-kolkata";
import { usePoll } from "@/components/hooks/usePoll";
import { CameraFocusProvider, useCameraFocus } from "@/components/hooks/useCameraFocus";
import { NotificationPermissionButton } from "@/components/events/NotificationPermissionButton";
import { Icon, type IconName } from "@/components/ui/Icon";
import { Mark } from "@/components/ui/Mark";
import { SystemHealthProvider, useSystemHealth } from "@/components/hooks/useSystemHealth";
import { useFocusTrap } from "@/components/hooks/useFocusTrap";

type NavItem = { href: string; label: string; short: string; icon: IconName; badge?: number };

const NAV_GROUPS: { label: string; items: NavItem[] }[] = [
  {
    label: "Monitor",
    items: [
      { href: "/", label: "Dashboard", short: "Home", icon: "dashboard" },
      { href: "/playback", label: "Playback", short: "Playback", icon: "playback" },
    ],
  },
  {
    label: "Security",
    items: [
      { href: "/events", label: "Events", short: "Events", icon: "events" },
      { href: "/faces", label: "Faces", short: "Faces", icon: "faces" },
      { href: "/notifications", label: "Notifications", short: "Alerts", icon: "bell" },
    ],
  },
  {
    label: "System",
    items: [
      // This page configures cameras; the live view is the dashboard.
      { href: "/cameras", label: "Camera setup", short: "Cameras", icon: "camera" },
      { href: "/device", label: "Device", short: "Device", icon: "device" },
      { href: "/settings", label: "Settings", short: "Settings", icon: "settings" },
    ],
  },
];

const MOBILE_NAV: NavItem[] = [
  { href: "/", label: "Dashboard", short: "Dashboard", icon: "dashboard" },
  { href: "/playback", label: "Playback", short: "Playback", icon: "playback" },
  { href: "/events", label: "Events", short: "Events", icon: "events" },
  { href: "/notifications", label: "Notifications", short: "Alerts", icon: "bell" },
];

/** Path prefix -> section name shown in the app bar breadcrumb. */
const SECTIONS: [string, string][] = [
  ["/events", "Investigate"],
  ["/faces", "Investigate"],
  ["/notifications", "Investigate"],
  ["/playback", "Monitor"],
  ["/cameras", "Configure"],
  ["/device", "Configure"],
  ["/account", "Account"],
  ["/settings", "Administration"],
];

function sectionFor(pathname: string): string {
  for (const [prefix, label] of SECTIONS) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return label;
  }
  return "Monitor";
}

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  if (!now) {
    return (
      <div className="clock" aria-hidden="true">
        <span className="clock__time">--:--:--</span>
        <span className="clock__date">Asia/Kolkata</span>
      </div>
    );
  }
  /*
   * 24-hour Asia/Kolkata, matching every other timestamp in the console and the
   * design system's stated time format (13:54:19, 04 Nov 2026).
   */
  return (
    <div className="clock">
      <time dateTime={now.toISOString()} className="clock__time">
        {formatKolkataClock(now)}
      </time>
      <span className="clock__date">{formatKolkataDate(now)}</span>
    </div>
  );
}

function navActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** Live unread count for the Events badge. Uses an existing filter only. */
function useUnreadCount(): number | null {
  const [unread, setUnread] = useState<number | null>(null);
  useEffect(() => {
    let ignore = false;
    const load = () => {
      void api<{ total?: unknown }>(`/api/events?date=${todayInKolkata()}&read=false&pageSize=1`)
        .then((body) => {
          if (!ignore && typeof body.total === "number") setUnread(body.total);
        })
        .catch(() => undefined);
    };
    load();
    const timer = setInterval(load, 60_000);
    const onEvent = () => load();
    window.addEventListener("cctv-event", onEvent);
    return () => {
      ignore = true;
      clearInterval(timer);
      window.removeEventListener("cctv-event", onEvent);
    };
  }, []);
  return unread;
}

function EventNotifier() {
  useEffect(() => {
    const source = new EventSource("/api/events/stream");
    source.onmessage = (message) => {
      let payload: {
        notify?: boolean;
        event?: CctvEvent & { cameraName?: string };
        face?: LiveFaceNotification;
      };
      try {
        payload = JSON.parse(message.data) as typeof payload;
      } catch {
        return;
      }
      if (!payload.event) return;
      window.dispatchEvent(new CustomEvent("cctv-event", { detail: payload }));
      if (typeof Notification === "undefined" || Notification.permission !== "granted") return;

      /*
       * Temporary face-detection test notification. It is a separate branch so
       * the existing motion/person notification below is untouched, and it says
       * "Face detected" — never a name, because nothing is recognised.
       */
      if (payload.face) {
        const options = faceNotificationOptions(payload.face);
        const faceNote = new Notification(options.title, { body: options.body, tag: options.tag });
        faceNote.onclick = () => {
          window.focus();
          navigate(options.href);
          faceNote.close();
        };
        return;
      }

      if (!payload.notify) return;
      const when = formatKolkataClock(new Date(payload.event.timestamp)).slice(0, 5);
      const eventId = payload.event.id;
      const note = new Notification("Home CCTV", {
        body: `${eventTitle(payload.event.type, payload.event.classification)}\nCamera: ${payload.event.cameraName ?? `Camera ${payload.event.cameraId}`}\nTime: ${when}`,
        tag: eventId,
      });
      // Opening the notification goes straight to the event detail page.
      note.onclick = () => {
        window.focus();
        navigate(`/events/${eventId}`);
        note.close();
      };
    };
    return () => source.close();
  }, []);
  return null;
}

function toneFor(status: DvrStatusResponse | null, error: string | null) {
  if (error && !status) return { tone: "offline" as const, label: error };
  if (!status) return { tone: "idle" as const, label: Messages.checking };
  if (status.dvr === "connected") return { tone: "online" as const, label: status.message };
  if (status.dvr === "auth_failed" || status.dvr === "not_configured") return { tone: "warn" as const, label: status.message };
  return { tone: "offline" as const, label: status.message };
}

function gatewayTone(status: DvrStatusResponse | null) {
  if (!status) return { tone: "idle" as const, label: Messages.checking };
  if (status.videoGateway === "connected") return { tone: "online" as const, label: Messages.gatewayUp };
  return { tone: "offline" as const, label: Messages.gatewayDown };
}

/**
 * Wraps the shell in the camera-focus provider so a page can hide the app chrome
 * while one camera fills the viewport.
 */
export function AppShell({
  children,
  role,
}: {
  children: React.ReactNode;
  role: "ADMIN" | "VIEWER";
}) {
  return (
    <SystemHealthProvider role={role}>
      <CameraFocusProvider>
        <AppShellInner role={role}>{children}</AppShellInner>
      </CameraFocusProvider>
    </SystemHealthProvider>
  );
}

function AppShellInner({ children, role }: { children: React.ReactNode; role: "ADMIN" | "VIEWER" }) {
  const pathname = usePathname();
  const { isFocused } = useCameraFocus();
  const { health } = useSystemHealth();
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const closeMore = useCallback(() => setMoreOpen(false), []);
  useFocusTrap(moreOpen, sheetRef, closeMore);
  const unread = useUnreadCount();
  const nav = NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items
      .filter((item) => item.href !== "/settings" || role === "ADMIN")
      .map((item) => (item.href === "/events" && unread && unread > 0 ? { ...item, badge: unread } : item)),
  })).filter((group) => group.items.length > 0);
  const { data, error } = usePoll<DvrStatusResponse>("/api/dvr/status");
  const lamp = toneFor(data, error);
  const gateway = gatewayTone(data);
  const streamNominal = lamp.tone === "online" && gateway.tone === "online";
  /*
   * The app-bar pill must never be a scoped check presented as a whole-system
   * verdict. For ADMINs it uses the aggregated /api/system/health status; for
   * VIEWERs (who cannot read that endpoint) it explicitly scopes itself to the
   * DVR and video gateway.
   */
  const healthTone: "online" | "warn" | "offline" | null =
    health === null ? null : health.status === "healthy" ? "online" : health.status === "degraded" ? "warn" : "offline";
  const pillTone = healthTone ?? (streamNominal ? "online" : "warn");
  const pillLabel =
    healthTone === null
      ? streamNominal
        ? "DVR & streams online"
        : lamp.label
      : healthTone === "online"
        ? "All systems nominal"
        : healthTone === "warn"
          ? "System degraded"
          : "System unhealthy";
  const section = sectionFor(pathname);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    navigate("/login");
  }

  const initials = "home".slice(0, 1).toUpperCase();

  return (
    <div className="shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div className="shell__body" inert={moreOpen ? true : undefined} aria-hidden={moreOpen ? true : undefined}>
        <aside className={`sidebar${isFocused ? " hidden" : ""}`}>
          <div className="brand">
            <Mark className="brand__mark" />
            <div>
              <div className="brand__name">Home CCTV</div>
              <div className="brand__sub">Local hub</div>
            </div>
          </div>
          <nav className="nav" aria-label="Primary">
            {nav.map((group) => (
              <div className="nav__group" key={group.label}>
                <div className="nav__label">{group.label}</div>
                {group.items.map((item) => {
                  const active = navActive(pathname, item.href);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className="nav__item"
                    >
                      <Icon name={item.icon} />
                      <span>{item.label}</span>
                      {item.badge ? <span className="nav__badge">{item.badge > 99 ? "99+" : item.badge}</span> : null}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
          <div className="sidebar__foot">
            <div className="shell-status">
              <div className="shell-status__head">
                <span>System</span>
                <Icon name="shield" className="icon icon-sm" />
              </div>
              <div className="shell-status__rows">
                <div className="shell-status__row">
                  <span className={`dot ${lamp.tone === "online" ? "dot--online" : lamp.tone === "offline" ? "dot--offline" : "dot--idle"}`} />
                  <span>DVR</span>
                  <span>{lamp.tone === "online" ? "Online" : lamp.label}</span>
                </div>
                <div className="shell-status__row">
                  <span className={`dot ${gateway.tone === "online" ? "dot--online" : gateway.tone === "offline" ? "dot--offline" : "dot--idle"}`} />
                  <span>Video gateway</span>
                  <span>{gateway.tone === "online" ? "Live" : "Down"}</span>
                </div>
                <div className="shell-status__row">
                  <span className="dot dot--idle" />
                  <span>Database</span>
                  <span>Local</span>
                </div>
              </div>
            </div>
            <Link href="/account" className="sidebar__account">
              <span className="avatar">{initials}</span>
              <span>home</span>
              {role ? <span className="badge" style={{ marginLeft: "auto" }}>{role === "ADMIN" ? "Admin" : "Viewer"}</span> : null}
            </Link>
            <button type="button" onClick={() => void logout()} className="logout-btn">
              <Icon name="logout" />
              <span>Log out</span>
            </button>
          </div>
        </aside>

        <div className="content flex min-w-0 flex-col md:h-dvh">
          <header className={`appbar${isFocused ? " hidden" : " flex"}`}>
            <div className="mobile-brand">
              <Mark className="brand__mark" />
              <span className="mobile-brand__name">Home CCTV</span>
            </div>
            <div className="appbar__crumb">
              <strong>Home CCTV</strong>
              <span className="sep">/</span>
              <span>{section}</span>
            </div>
            <div className="appbar__spacer" />
            <div className="appbar__actions">
              <span className={`pill pill--hide-sm${pillTone === "online" ? "" : " pill--warn"}`}>
                <span className={`dot ${pillTone === "online" ? "dot--online" : pillTone === "offline" ? "dot--offline" : "dot--warn"}`} />
                {pillLabel}
              </span>
              <NotificationPermissionButton />
              <Clock />
              <Link href="/account" className="icon-btn" aria-label="Account">
                <span className="avatar">{initials}</span>
              </Link>
            </div>
          </header>
          <EventNotifier />
          {/*
            min-h-0 lets this scroll region shrink inside the flex column, and
            `md:flex-1` makes it take the remaining viewport height so a page can
            size itself to the screen instead of the document.
          */}
          <main
            id="main"
            className={isFocused ? "min-h-0" : "min-h-0 px-3 pt-4 md:flex-1 md:overflow-y-auto md:px-6"}
          >
            {children}
          </main>
        </div>
      </div>

      {/* Mobile navigation: one Primary nav per viewport; this one is display:none on desktop. */}
      <nav className={`mobile-nav${isFocused ? " hidden" : ""}`} aria-label="Primary" inert={moreOpen ? true : undefined} aria-hidden={moreOpen ? true : undefined}>
        {MOBILE_NAV.map((item) => {
          const active = navActive(pathname, item.href);
          const count = item.href === "/events" ? unread : null;
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className="mobile-nav__item">
              <Icon name={item.icon} />
              <span>{item.short}</span>
              {count && count > 0 ? (
                <span className="mobile-nav__badge" aria-label={`${count > 99 ? "99+" : count} unread today`}>
                  {count > 99 ? "99+" : count}
                </span>
              ) : null}
            </Link>
          );
        })}
        <button type="button" className="mobile-nav__more" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen}>
          <Icon name="more" />
          <span>More</span>
        </button>
      </nav>

      <div className="sheet-backdrop" data-open={moreOpen ? "true" : "false"} onClick={closeMore} />
      <div
        ref={sheetRef}
        className="sheet"
        data-open={moreOpen ? "true" : "false"}
        aria-hidden={!moreOpen}
        role="dialog"
        aria-modal={moreOpen ? "true" : undefined}
        aria-label="More navigation"
        tabIndex={-1}
      >
        <div className="sheet__handle" />
        <div className="sheet__head">
          <span className="sheet__title">More</span>
          <button type="button" className="icon-btn" aria-label="Close navigation" onClick={closeMore}>
            <Icon name="close" className="icon icon-sm" />
          </button>
        </div>
        <div className="sheet__grid">
          <Link href="/faces" className="sheet__item" onClick={() => setMoreOpen(false)}>
            <Icon name="faces" /> Faces
          </Link>
          <Link href="/cameras" className="sheet__item" onClick={() => setMoreOpen(false)}>
            <Icon name="camera" /> Camera setup
          </Link>
          <Link href="/device" className="sheet__item" onClick={() => setMoreOpen(false)}>
            <Icon name="device" /> Device
          </Link>
          {role === "ADMIN" ? (
            <Link href="/settings" className="sheet__item" onClick={() => setMoreOpen(false)}>
              <Icon name="settings" /> Settings
            </Link>
          ) : null}
          <Link href="/account" className="sheet__item" onClick={() => setMoreOpen(false)}>
            <Icon name="user" /> Account
          </Link>
          <button
            type="button"
            className="sheet__item"
            onClick={() => {
              setMoreOpen(false);
              void logout();
            }}
          >
            <Icon name="logout" /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}
