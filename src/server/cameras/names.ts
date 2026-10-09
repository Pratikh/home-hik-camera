import "server-only";
import { CAMERA_COUNT, defaultCameraName, normalizeCameraName } from "@/server/cameras/channels";
import { readCameraNameOverrides } from "@/server/cameras/store";
import { getDvrOverview } from "@/server/hikvision/hikvision-status";

/**
 * Resolve the display name for every camera.
 *
 * Precedence:
 *   1. A name explicitly saved in this hub (`data/cameras.json`) — an admin
 *      override, set from the Cameras page.
 *   2. The channel name configured on the DVR itself (`/ISAPI/System/Video/inputs/channels`).
 *   3. The generic fallback, "Camera N".
 *
 * The DVR is the source of truth by default, so renaming a channel on the DVR is
 * reflected here without any code change. The local file only wins when someone
 * deliberately overrode the name in this hub.
 *
 * Names are validated before use: the DVR value is free text and could contain
 * characters the UI does not expect.
 */
export type CameraNames = {
  names: Record<number, string>;
  /** True when at least one name came from the DVR. */
  fromDvr: boolean;
};

export function namesFromChannels(channels: Array<{ id: number; name: string | null }> | null): Record<number, string> {
  const resolved: Record<number, string> = {};
  if (!channels) return resolved;
  for (const channel of channels) {
    if (!Number.isInteger(channel.id) || channel.id < 1 || channel.id > CAMERA_COUNT) continue;
    if (!channel.name) continue;
    const normalized = normalizeCameraName(channel.name);
    if (normalized) resolved[channel.id] = normalized;
  }
  return resolved;
}

export function resolveCameraNames(
  overrides: Record<number, string>,
  dvrNames: Record<number, string>,
): CameraNames {
  const names: Record<number, string> = {};
  let fromDvr = false;
  for (let id = 1; id <= CAMERA_COUNT; id += 1) {
    const override = usableOverride(id, overrides[id]);
    if (override) {
      names[id] = override;
      continue;
    }
    const dvr = dvrNames[id];
    if (dvr) {
      names[id] = dvr;
      fromDvr = true;
      continue;
    }
    names[id] = defaultCameraName(id);
  }
  return { names, fromDvr };
}

/**
 * A saved name that is just the generic fallback ("Camera 2") is treated as no
 * override at all.
 *
 * Without this, an install that previously stored the default would keep showing
 * "Camera 2" forever and never pick up the name already configured on the DVR.
 * An explicit, non-default override still wins.
 */
function usableOverride(id: number, value: string | undefined): string | null {
  if (!value) return null;
  return value === defaultCameraName(id) ? null : value;
}

/**
 * Read the effective camera names.
 *
 * `getDvrOverview()` already caches the DVR response (8s when connected, longer
 * when it is failing), so a page render does not hit the DVR each time. When the
 * DVR is unreachable the saved names and the generic fallback are used, so Live
 * View never breaks because a name could not be read.
 */
export async function getCameraNames(dataDir: string): Promise<CameraNames> {
  const overrides = await readCameraNameOverrides(dataDir);
  let dvrNames: Record<number, string> = {};
  try {
    const overview = await getDvrOverview();
    dvrNames = namesFromChannels(overview.channels);
  } catch (error) {
    // A name lookup must never be the reason a camera fails to appear.
    console.error("[cameras] dvr names", error instanceof Error ? error.name : "error");
  }
  return resolveCameraNames(overrides, dvrNames);
}

/** Convenience wrapper returning just the id -> name map. */
export async function getCameraNameMap(dataDir: string): Promise<Record<number, string>> {
  return (await getCameraNames(dataDir)).names;
}
