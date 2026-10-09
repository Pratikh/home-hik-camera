export const CAMERA_COUNT = 4;

export type CameraChannel = {
  id: number;
  mainChannel: number;
  subChannel: number;
  mainPath: string;
  subPath: string;
};

export function cameraChannels(): CameraChannel[] {
  return Array.from({ length: CAMERA_COUNT }, (_, index) => {
    const id = index + 1;
    return {
      id,
      mainChannel: id * 100 + 1,
      subChannel: id * 100 + 2,
      mainPath: `cam${id}_main`,
      subPath: `cam${id}_sub`,
    };
  });
}

/**
 * The one source of truth for camera ids. Components and routes that need a
 * list of cameras use this so a change to CAMERA_COUNT does not require editing
 * every `[1, 2, 3, 4]` literal.
 */
export const CAMERA_IDS: readonly number[] = cameraChannels().map((camera) => camera.id);

/** True when the value is a camera id this system actually has. */
export function isCameraId(value: unknown): value is number {
  return typeof value === "number" && CAMERA_IDS.includes(value);
}

export function playbackPath(): string {
  return "playback";
}

export function describePlaybackPath(path: string): { cameraId: number; track: number } | null {
  if (path === "playback") return { cameraId: 0, track: 0 };
  const match = /^pb([1-4])$/.exec(path);
  if (!match) return null;
  const cameraId = Number(match[1]);
  return { cameraId, track: cameraId * 100 + 1 };
}

export function isRelayPath(path: string): boolean {
  return describeStreamPath(path) !== null || describePlaybackPath(path) !== null;
}

export function describeStreamPath(
  path: string,
): { cameraId: number; channel: number; kind: "main" | "sub" } | null {
  for (const camera of cameraChannels()) {
    if (path === camera.mainPath) {
      return { cameraId: camera.id, channel: camera.mainChannel, kind: "main" };
    }
    if (path === camera.subPath) {
      return { cameraId: camera.id, channel: camera.subChannel, kind: "sub" };
    }
  }
  return null;
}

export function defaultCameraName(id: number): string {
  return `Camera ${id}`;
}

export function normalizeCameraName(input: string): string | null {
  const name = input.trim().replace(/\s+/g, " ");
  if (!/^[\p{L}\p{N}][\p{L}\p{N} ._'()-]{0,31}$/u.test(name)) return null;
  return name;
}
