"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/client-api";

export function usePoll<T>(url: string, intervalMs = 15000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    try {
      const next = await api<T>(url);
      setData(next);
      setError(null);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : "Backend unavailable");
    } finally {
      setLoading(false);
    }
  }, [url]);

  useEffect(() => {
    let ignore = false;
    const load = async () => {
      try {
        const next = await api<T>(url);
        if (ignore) return;
        setData(next);
        setError(null);
      } catch (caught) {
        if (ignore || (caught instanceof ApiError && caught.status === 401)) return;
        setError(caught instanceof Error ? caught.message : "Backend unavailable");
      } finally {
        if (!ignore) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(() => void load(), intervalMs);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      ignore = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [intervalMs, url]);

  return { data, error, loading, reload };
}
