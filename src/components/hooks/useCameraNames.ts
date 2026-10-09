"use client";

import { useEffect, useState } from "react";
import type { CamerasResponse } from "@/lib/api-types";
import { api } from "@/lib/client-api";

/**
 * Camera display names for client components.
 *
 * The names come from `/api/cameras`, which resolves them server-side from the
 * DVR (falling back to a local override or "Camera N"). Nothing here talks to the
 * DVR and no DVR credential reaches the browser.
 *
 * The result is cached at module scope so several components on a page share one
 * request instead of each issuing its own.
 */
let cache: Promise<Record<number, string>> | null = null;

function loadNames(): Promise<Record<number, string>> {
  if (!cache) {
    cache = api<CamerasResponse>("/api/cameras")
      .then((body) => {
        const names: Record<number, string> = {};
        for (const camera of body.cameras) names[camera.id] = camera.name;
        return names;
      })
      .catch((error: unknown) => {
        // Allow a later mount to retry after a transient failure.
        cache = null;
        throw error;
      });
  }
  return cache;
}

/** Test helper: drop the cached names so the next call refetches. */
export function resetCameraNameCache(): void {
  cache = null;
}

export function useCameraNames(): Record<number, string> {
  const [names, setNames] = useState<Record<number, string>>({});

  useEffect(() => {
    let ignore = false;
    void loadNames()
      .then((resolved) => {
        if (!ignore) setNames(resolved);
      })
      .catch(() => undefined);
    return () => {
      ignore = true;
    };
  }, []);

  return names;
}

/** Name for one camera, with the same fallback the server uses. */
export function cameraName(names: Record<number, string>, id: number): string {
  return names[id] ?? `Camera ${id}`;
}
