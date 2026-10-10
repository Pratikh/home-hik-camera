"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { DvrStatusResponse } from "@/lib/api-types";
import { navigate } from "@/lib/client-api";
import { eventTitle, type CctvEvent } from "@/lib/events";
import { faceNotificationOptions, type LiveFaceNotification } from "@/lib/faces";
import { Messages } from "@/lib/messages";
import { formatKolkataClock } from "@/lib/time-kolkata";
import { usePoll } from "@/components/hooks/usePoll";
import { CameraFocusProvider, useCameraFocus } from "@/components/hooks/useCameraFocus";
import { NotificationPermissionButton } from "@/components/events/NotificationPermissionButton";
import { Mark } from "@/components/ui/Mark";
import { StatusLamp } from "@/components/ui/StatusLamp";

/**
 * `short` is the label used by the mobile bottom bar, where a 7-column grid
 * leaves roughly 46-61px per item and the full words collide. The desktop
 * sidebar always uses the full `label`.
 */
const NAV = [
  { href: "/", label: "Dashboard", short: "Home" },
  { href: "/cameras", label: "Cameras", short: "Cameras" },
  { href: "/playback", label: "Playback", short: "Playback" },
  { href: "/events", label: "Events", short: "Events" },
  { href: "/faces", label: "Faces", short: "Faces" },
  { href: "/notifications", label: "Notifications", short: "Alerts" },
  { href: "/device", label: "Device", short: "Device" },
  { href: "/settings", label: "Settings", short: "Settings" },
];

function Clock() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, []);
  if (!now) return <span className="font-mono text-sm text-muted">--:--:--</span>;
  return (
    <time dateTime={now.toISOString()} className="hidden font-mono text-sm tabular-nums sm:inline">
      {now.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
    </time>
  );
}

function navActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
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

/**
 * Wraps the shell in the camera-focus provider so a page can hide the app chrome
 * while one camera fills the viewport.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <CameraFocusProvider>
      <AppShellInner>{children}</AppShellInner>
    </CameraFocusProvider>
  );
}

function AppShellInner({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { isFocused } = useCameraFocus();
  const [role, setRole] = useState<"ADMIN" | "VIEWER" | null>(null);
  useEffect(() => {
    void fetch("/api/auth/session", { credentials: "same-origin" })
      .then((response) => response.json())
      .then((body: { role?: unknown }) => setRole(body.role === "VIEWER" ? "VIEWER" : body.role === "ADMIN" ? "ADMIN" : null))
      .catch(() => undefined);
  }, []);
  const nav = NAV.filter((item) => item.href !== "/settings" || role === "ADMIN");
  const { data, error } = usePoll<DvrStatusResponse>("/api/dvr/status");
  const lamp = toneFor(data, error);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    navigate("/login");
  }

  return (
    <div className="min-h-dvh bg-bg text-ink">
      <div className="md:grid md:h-dvh md:grid-cols-[220px_minmax(0,1fr)]">
        {/*
          Sticky sidebar: the logout control must stay reachable on tall pages
          instead of being pushed to the bottom of the document.
        */}
        <aside className={`${isFocused ? "hidden" : "hidden md:sticky md:top-0 md:flex"} border-r border-line bg-panel md:h-dvh md:flex-col`}>
          <div className="flex items-center gap-3 px-4 py-5">
            <Mark />
            <div>
              <p className="text-sm font-semibold">Home CCTV</p>
              <p className="text-xs text-muted">Local hub</p>
            </div>
          </div>
          <nav className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3" aria-label="Primary">
            {nav.map((item) => {
              const active = navActive(pathname, item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`rounded-lg px-3 py-2 text-sm ${active ? "bg-white/10 text-teal" : "text-ink hover:bg-white/5"}`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-line p-3">
            <button type="button" onClick={() => void logout()} className="h-10 w-full rounded-lg px-3 text-left text-sm text-muted hover:bg-white/5 hover:text-ink">
              Log out
            </button>
          </div>
        </aside>
        <div className="flex min-w-0 flex-col md:h-dvh">
          <header className={`${isFocused ? "hidden" : "sticky top-0 z-30 flex"} items-center justify-between gap-2 border-b border-line bg-bg px-3 py-3 md:px-6`}>
            <div className="flex min-w-0 items-center gap-2">
              <Mark className="h-7 w-7 shrink-0 md:hidden" />
              <p className="truncate text-sm font-semibold md:text-base">Home CCTV</p>
            </div>
            {/* shrink-0 + nowrap keeps every action on one line; the status lamp is
                the only element allowed to compress. */}
            <div className="flex shrink-0 items-center gap-3">
              <StatusLamp tone={lamp.tone} label={lamp.label} compact />
              <Clock />
              <NotificationPermissionButton />
              <button
                type="button"
                onClick={() => void logout()}
                className="h-9 shrink-0 whitespace-nowrap rounded-lg border border-line px-3 text-xs text-muted hover:bg-white/5 hover:text-ink md:hidden"
              >
                Log out
              </button>
            </div>
          </header>
          <EventNotifier />
          {/*
            min-h-0 lets this scroll region shrink inside the flex column, and
            `md:flex-1` makes it take the remaining viewport height so a page can
            size itself to the screen instead of the document.
          */}
          <main className={isFocused ? "min-h-0" : "min-h-0 px-3 pb-28 pt-4 md:flex-1 md:overflow-y-auto md:px-6 md:pb-6"}>{children}</main>
        </div>
      </div>
      {/*
        Mobile bottom bar: min-w-0 + truncate means a long label can never
        overlap its neighbour. Eight items now that Faces is part of the nav.
      */}
      <nav
        className={`${isFocused ? "hidden" : "fixed inset-x-0 bottom-0 z-40 grid"} grid-cols-8 border-t border-line bg-panel md:hidden`}
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        aria-label="Primary"
      >
        {nav.map((item) => {
          const active = navActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              title={item.label}
              className={`min-w-0 truncate px-0.5 py-3 text-center text-[11px] leading-tight ${active ? "text-teal" : "text-muted"}`}
            >
              {item.short}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}