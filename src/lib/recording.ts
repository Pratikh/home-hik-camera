import { Messages } from "@/lib/messages";
import { isCalendarDate, parseClock } from "@/lib/time-kolkata";

export type RecordingType = "continuous" | "motion" | "alarm" | "manual" | "other";

export type Recording = {
  id: string;
  camera: number;
  startTime: string;
  endTime: string;
  type: RecordingType | null;
  label: string;
};

export type SearchParamsInput = {
  camera: string | null;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
};

export type SearchQuery = {
  camera: number;
  date: string;
  startTime: string;
  endTime: string;
};

export function recordingLabel(type: RecordingType | null): string {
  if (type === "continuous") return "Continuous";
  if (type === "motion") return "Motion";
  if (type === "alarm") return "Alarm";
  if (type === "manual") return "Manual";
  if (type === "other") return "Other";
  return "Recording";
}

export function normalizeRecordingType(descriptor: string | null): RecordingType | null {
  if (!descriptor) return null;
  const value = descriptor.trim().toLowerCase();
  if (!value) return null;
  if (value.endsWith("/timing") || value.endsWith("/cmr") || value.includes("continuous")) return "continuous";
  if (value.endsWith("/motion") || value.includes("/motion")) return "motion";
  if (value.endsWith("/alarm") || value.includes("/alarm")) return "alarm";
  if (value.endsWith("/manual") || value.includes("/manual")) return "manual";
  return "other";
}

export function recordingId(camera: number, start: Date, end: Date): string {
  return `c${camera}-${start.getTime().toString(36)}-${end.getTime().toString(36)}`;
}

export function parseSearchParams(
  input: SearchParamsInput,
): { ok: true; query: SearchQuery } | { ok: false; message: string } {
  if (!input.camera || !/^[1-4]$/.test(input.camera)) {
    return { ok: false, message: Messages.invalidCamera };
  }
  if (!input.date || !isCalendarDate(input.date)) {
    return { ok: false, message: Messages.invalidDate };
  }
  const startTime = parseClock((input.startTime ?? "").trim() || "00:00");
  const endTime = parseClock((input.endTime ?? "").trim() || "23:59");
  if (!startTime || !endTime || endTime <= startTime) {
    return { ok: false, message: Messages.invalidTime };
  }
  return {
    ok: true,
    query: { camera: Number(input.camera), date: input.date, startTime, endTime },
  };
}

export function playbackMockAllowed(env: { NODE_ENV?: string; PLAYBACK_DEV_MOCK?: string }): boolean {
  return env.NODE_ENV !== "production" && (env.PLAYBACK_DEV_MOCK ?? "").trim().toLowerCase() === "true";
}

export function mockRecordings(camera: number, date: string): Recording[] {
  const firstStart = `${date}T08:15:00+05:30`;
  const firstEnd = `${date}T09:45:00+05:30`;
  const secondStart = `${date}T12:20:00+05:30`;
  const secondEnd = `${date}T13:18:00+05:30`;
  return [
    {
      id: `mock-${camera}-a`,
      camera,
      startTime: firstStart,
      endTime: firstEnd,
      type: "continuous",
      label: "Continuous",
    },
    {
      id: `mock-${camera}-b`,
      camera,
      startTime: secondStart,
      endTime: secondEnd,
      type: "motion",
      label: "Motion",
    },
  ];
}

export const DOWNLOAD_UNAVAILABLE = {
  available: false as const,
  message: Messages.downloadUnavailable,
};
