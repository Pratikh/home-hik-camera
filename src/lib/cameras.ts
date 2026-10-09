/**
 * Client-safe camera configuration.
 *
 * This mirrors the server-side camera plan in `src/server/cameras/channels.ts`
 * without importing server-only code, so client components can render the same
 * set of cameras the rest of the system actually has. CAMERA_COUNT is the single
 * number that drives the ids.
 */
export const CAMERA_COUNT = 4;

export const CAMERA_IDS: readonly number[] = Array.from({ length: CAMERA_COUNT }, (_, index) => index + 1);

export function isValidCameraId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= CAMERA_COUNT;
}