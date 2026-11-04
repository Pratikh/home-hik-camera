"use client";

import { useEffect, type RefObject } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Minimal modal focus management for overlays that are visually modal.
 *
 * While `active`:
 * - moves focus into the container (first focusable element, or the container),
 * - traps Tab / Shift+Tab inside it,
 * - closes on Escape via `onClose`,
 * - locks background scrolling,
 * - restores focus to the element that opened it on deactivation.
 *
 * The container should carry `role="dialog"` (or an appropriate dialog role)
 * and `aria-modal="true"`; the hook only manages behaviour.
 */
export function useFocusTrap(
  active: boolean,
  ref: RefObject<HTMLElement | null>,
  onClose?: () => void,
): void {
  useEffect(() => {
    if (!active) return;
    const container = ref.current;
    if (!container) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const focusable = () =>
      Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => {
        const style = window.getComputedStyle(element);
        return style.visibility !== "hidden" && style.display !== "none" && element.getClientRects().length > 0;
      });

    const first = focusable()[0] ?? container;
    first.focus({ preventScroll: true });

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && onClose) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (event.shiftKey && index <= 0) {
        event.preventDefault();
        items[items.length - 1]?.focus();
      } else if (!event.shiftKey && index === items.length - 1) {
        event.preventDefault();
        items[0]?.focus();
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.({ preventScroll: true });
    };
  }, [active, ref, onClose]);
}
