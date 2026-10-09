"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { DvrStatusResponse } from "@/lib/api-types";
import { navigate } from "@/lib/client-api";
import { eventTitle, type CctvEvent } from "@/lib/events";
import { Messages } from "@/lib/messages";
import { formatKolkataClock } from "@/lib/time-kolkata";
import { usePoll } from "@/components/hooks/usePoll";
import { NotificationPermissionButton } from "@/components/events/NotificationPermissionButton";
import { Mark } from "@/components/ui/Mark";
import { StatusLamp } from "@/components/ui/StatusLamp";

const NAV = [
  { href: "/", label: "Dashboard" },
  { href: "/cameras", label: "Cameras" },
  { href: "/playback", label: "Playback" },
  { href: "/events", label: "Events" },
  { href: "/notifications", label: "Notifications" },
  { href: "/device", label: "Device" },
  { href: "/settings", label: "Settings" },
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
    <time dateTime={now.toISOString()} className="font-mono text-sm tabular-nums">
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
      let payload: { notify?: boolean; event?: CctvEvent & { cameraName?: string } };
      try {
        payload = JSON.parse(message.data) as { notify?: boolean; event?: CctvEvent & { cameraName?: string } };
      } catch {
        return;
      }
      if (!payload.event) return;
      window.dispatchEvent(new CustomEvent("cctv-event", { detail: payload }));
      if (!payload.notify || typeof Notification === "undefined" || Notification.permission !== "granted") return;
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

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
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
      <div className="md:grid md:min-h-dvh md:grid-cols-[220px_minmax(0,1fr)]">
        <aside className="hidden border-r border-line bg-panel md:flex md:flex-col">
          <div className="flex items-center gap-3 px-4 py-5">
            <Mark />
            <div>
              <p className="text-sm font-semibold">Home CCTV</p>
              <p className="text-xs text-muted">Local hub</p>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3" aria-label="Primary">
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
          <div className="p-3">
            <button type="button" onClick={() => void logout()} className="w-full rounded-lg px-3 py-2 text-left text-sm text-muted hover:bg-white/5 hover:text-ink">
              Log out
            </button>
          </div>
        </aside>
        <div className="min-w-0">
          <header className="sticky top-0 z-30 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-bg px-3 py-3 md:px-6">
            <div className="flex min-w-0 items-center gap-3">
              <Mark className="h-7 w-7 md:hidden" />
              <p className="truncate text-sm font-semibold md:text-base">Home CCTV</p>
            </div>
            <div className="flex items-center gap-4">
              <StatusLamp tone={lamp.tone} label={lamp.label} />
              <Clock />
              <NotificationPermissionButton />
              <button type="button" onClick={() => void logout()} className="text-sm text-muted md:hidden">
                Log out
              </button>
            </div>
          </header>
          <EventNotifier />
      <main className="px-3 pb-28 pt-4 md:px-6 md:pb-8">{children}</main>
        </div>
      </div>
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-7 border-t border-line bg-panel md:hidden"
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
              className={`px-1 py-3 text-center text-[11px] leading-tight ${active ? "text-teal" : "text-muted"}`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
