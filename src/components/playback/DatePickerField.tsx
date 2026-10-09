"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { PlaybackCalendar } from "@/components/playback/PlaybackCalendar";
import { popoverWidth, shouldAlignRight, POPOVER_WIDTH } from "@/lib/date-popover";

/**
 * The playback Date field.
 *
 * The value looks and behaves like the other filter inputs, but the calendar
 * opens as a popover anchored to this field rather than occupying a permanent
 * column. When closed it takes no space beyond the field itself.
 */
export function DatePickerField({
  date,
  month,
  recorded,
  status,
  error,
  onMonthChange,
  onSelect,
  onReload,
}: {
  date: string;
  month: string;
  recorded: string[];
  status: "idle" | "loading" | "ready" | "error";
  error: string | null;
  onMonthChange: (month: string) => void;
  onSelect: (date: string) => void;
  onReload: () => void;
}) {
  const [open, setOpen] = useState(false);
  /* Which edge the popover hangs from, and how wide it may be, so it always
     stays inside the viewport. Both are measured after mount. */
  const [alignRight, setAlignRight] = useState(false);
  const [width, setWidth] = useState(POPOVER_WIDTH);
  const wrapRef = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const close = useCallback(() => setOpen(false), []);

  /*
   * Close on an outside press or Escape. A press inside the field or the popover
   * is ignored, so interacting with the calendar keeps it open.
   */
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const node = wrapRef.current;
      if (node && event.target instanceof Node && !node.contains(event.target)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // Close the calendar only; stay on the playback page.
      event.stopPropagation();
      close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open, close]);

  /*
   * Flip to right-alignment when the field sits too close to the right edge for
   * the popover to fit, which is the common case on a phone in two-column mode.
   */
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const node = wrapRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      setWidth(popoverWidth(window.innerWidth));
      setAlignRight(shouldAlignRight(rect.left, window.innerWidth));
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [open]);

  const loading = status === "loading";

  return (
    <div ref={wrapRef} className="relative">
      <span className="mb-1 block text-sm text-muted" id={`${panelId}-label`}>
        Date
      </span>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-labelledby={`${panelId}-label`}
        className="flex h-11 w-full items-center justify-between gap-2 rounded-lg border border-line bg-card px-3 text-left font-mono text-sm text-ink hover:bg-white/5"
      >
        <span>{date}</span>
        <CalendarIcon />
      </button>

      {open ? (
        <div
          id={panelId}
          role="dialog"
          aria-label="Choose playback date"
          className={`absolute top-[calc(100%+0.5rem)] z-50 max-w-[calc(100vw-1.5rem)] rounded-xl shadow-2xl shadow-black/60 ${
            alignRight ? "right-0" : "left-0"
          }`}
          style={{ width: `${width}px` }}
        >
          {status === "error" ? (
            <div className="rounded-xl border border-warn/50 bg-card p-3 text-sm" role="alert">
              <p>{error ?? "Unable to check recording availability."}</p>
              <button type="button" onClick={onReload} className="mt-2 h-9 rounded-lg border border-line px-3 text-xs">
                Try again
              </button>
            </div>
          ) : (
            /* The calendar supplies its own surface; the wrapper adds the shadow. */
            <PlaybackCalendar
              month={month}
              selected={date}
              recorded={recorded}
              loading={loading}
              onMonthChange={onMonthChange}
              onSelect={(next) => {
                // Choosing a date applies it and dismisses the popover.
                onSelect(next);
                close();
              }}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0 text-muted" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" strokeLinecap="round" />
    </svg>
  );
}
