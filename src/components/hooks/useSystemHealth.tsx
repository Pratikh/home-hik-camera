"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { SystemHealthBody } from "@/lib/api-types";
import { usePoll } from "@/components/hooks/usePoll";

type SystemHealthContextValue = {
  /** Aggregated health, only fetched for ADMIN (the endpoint is ADMIN-only). */
  health: SystemHealthBody | null;
  role: "ADMIN" | "VIEWER" | null;
};

const SystemHealthContext = createContext<SystemHealthContextValue>({ health: null, role: null });

/**
 * One aggregated health poll for the whole shell.
 *
 * The app-bar pill and the dashboard "System snapshot" both derive from this
 * single source, so the summary can never say "All systems nominal" while the
 * system page reports degraded. The request is skipped for VIEWER sessions
 * because `/api/system/health` is ADMIN-only; consumers fall back to the
 * DVR/video-gateway signal in that case.
 */
export function SystemHealthProvider({
  role,
  children,
}: {
  role: "ADMIN" | "VIEWER" | null;
  children: ReactNode;
}) {
  const { data } = usePoll<SystemHealthBody>("/api/system/health", 60_000, role === "ADMIN");
  return <SystemHealthContext.Provider value={{ health: data, role }}>{children}</SystemHealthContext.Provider>;
}

export function useSystemHealth(): SystemHealthContextValue {
  return useContext(SystemHealthContext);
}
