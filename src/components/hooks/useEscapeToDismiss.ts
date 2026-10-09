"use client";

import { useEffect } from "react";

/**
 * Dismiss an inline confirmation with the Escape key.
 *
 * Used by the destructive-action confirmations (delete user, delete rule) so
 * they behave like the dialogs they are, without pulling in a modal framework.
 */
export function useEscapeToDismiss(active: boolean, onDismiss: () => void): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, onDismiss]);
}