"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Width of an element, kept current through a ResizeObserver.
 *
 * Returns `ref` to attach and the measured width in CSS pixels (0 until the
 * first measurement). The timeline uses this to decide how aggressively to group
 * event markers, so density stays correct on a phone and on a wide monitor.
 */
export function useElementWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof ResizeObserver === "undefined") {
      setWidth(node.getBoundingClientRect().width);
      return;
    }
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(node);
    setWidth(node.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  return { ref, width };
}
