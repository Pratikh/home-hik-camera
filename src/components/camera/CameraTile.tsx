"use client";

import { useEffect, useRef } from "react";
import type { CameraView } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { LivePlayer } from "@/components/camera/LivePlayer";
import { MessagePanel } from "@/components/ui/States";
import { StatusLamp } from "@/components/ui/StatusLamp";
import { Icon } from "@/components/ui/Icon";
import { useFocusTrap } from "@/components/hooks/useFocusTrap";

/**
 * One camera in the live wall.
 *
 * The video wrapper is deliberately the first child of the <article>: the QA
 * suite measures it, and focus mode reuses the SAME mounted player element so
 * entering/leaving focus never tears down the WebRTC session.
 *
 * Only one control carries the accessible name "Open <name> full screen" — the
 * top-right expand chip — so role-based locators resolve to a single match.
 */
export function CameraTile({
  camera,
  suspended,
  active,
  focused,
  hidden = false,
  eventCount = null,
  onExpand,
  onExitFocus,
}: {
  camera: CameraView;
  suspended: string | null;
  active: boolean;
  /** When true this tile's video fills the viewport in focus mode. */
  focused: boolean;
  /** Hidden while another camera is focused (display:none keeps it mounted). */
  hidden?: boolean;
  /** Events seen today on this camera, if known. */
  eventCount?: number | null;
  onExpand: () => void;
  onExitFocus: () => void;
}) {
  const articleRef = useRef<HTMLElement | null>(null);
  const expandRef = useRef<HTMLButtonElement | null>(null);
  // Focus mode is a modal surface: keep Tab inside the focused tile, close on
  // Escape, and restore focus to the expand control on exit.
  useFocusTrap(focused, articleRef, onExitFocus);
  useEffect(() => {
    if (!focused) return;
    const trigger = expandRef.current;
    return () => {
      // The tile stays mounted after leaving focus; return the keyboard user to
      // the control that opened it.
      requestAnimationFrame(() => trigger?.focus({ preventScroll: true }));
    };
  }, [focused]);
  const tone = camera.online === true ? "online" : camera.online === false ? "offline" : "warn";
  const signal = camera.online === true ? Messages.online : camera.online === false ? Messages.offline : Messages.notReported;

  return (
    <article
      ref={articleRef as React.RefObject<HTMLElement>}
      tabIndex={focused ? -1 : undefined}
      className={
        focused
          ? "camera camera--focused"
          : `camera${hidden ? " hidden" : ""}`
      }
      aria-label={focused ? `${camera.name} focus view` : undefined}
    >
      <div className="camera__video">
        {suspended ? (
          <MessagePanel message={suspended} />
        ) : (
          <LivePlayer path={camera.subPath} active={active} label={camera.name} />
        )}

        {focused ? (
          <>
            <div className="camera__overlay">
              <div className="camera__top">
                <span className="camera__live">{camera.name}</span>
                <button
                  type="button"
                  onClick={onExitFocus}
                  className="btn btn--sm"
                  aria-label={`Exit focus view for ${camera.name}`}
                  autoFocus
                >
                  <Icon name="close" className="icon icon-sm" />
                  Exit
                </button>
              </div>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex justify-end p-3 sm:p-5">
              <StatusLamp tone={tone} label={signal} compact />
            </div>
          </>
        ) : (
          <div className="camera__overlay">
            <div className="camera__top">
              <button
                ref={expandRef}
                type="button"
                onClick={onExpand}
                className="camera__expand"
                aria-label={`Open ${camera.name} full screen`}
              >
                <Icon name="expand" className="icon icon-sm" />
                <span>Full screen</span>
              </button>
            </div>
            <div className="camera__bottom" style={{ justifyContent: "flex-end" }}>
              <span className="camera__signal">
                <span className={`dot ${tone === "online" ? "dot--online" : tone === "offline" ? "dot--offline" : "dot--warn"}`} />
                {signal}
              </span>
            </div>
          </div>
        )}
      </div>

      {focused ? null : (
        <div className="camera__caption">
          <div className="camera__caption-main">
            <h2 className="camera__name">{camera.name}</h2>
            <div className="camera__meta">
              Sub {camera.subChannel}
              {eventCount !== null ? ` · ${eventCount} events today` : ""}
            </div>
          </div>
          <div className="camera__caption-side">
            <StatusLamp tone={tone} label={signal} compact />
          </div>
        </div>
      )}
    </article>
  );
}
