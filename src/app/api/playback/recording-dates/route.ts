import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { mockRecordings, playbackMockAllowed } from "@/lib/recording";
import { requireUser } from "@/server/http/require-user";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import { fetchRecordingDates, isMonth, recordingDatesCache } from "@/server/hikvision/hikvision-recording-dates";
import { HikvisionError } from "@/server/hikvision/hikvision-types";
import { CAMERA_COUNT } from "@/server/cameras/channels";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Recording availability for one camera and month.
 *
 * The browser never talks to the DVR: this route performs the ISAPI search using
 * the server-side credentials and returns only a list of dates.
 *
 * A DVR failure is reported as a failure (502/503), never as "no recordings", so
 * the UI can tell "this month is empty" apart from "we could not ask the DVR".
 */
export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const camera = Number(url.searchParams.get("camera"));
  const month = (url.searchParams.get("month") ?? "").trim();

  if (!Number.isInteger(camera) || camera < 1 || camera > CAMERA_COUNT) {
    return NextResponse.json({ error: Messages.invalidCamera }, { status: 400 });
  }
  if (!isMonth(month)) {
    return NextResponse.json({ error: Messages.invalidDate }, { status: 400 });
  }

  const config = getConfig();
  if (!config.dvrConfigured) {
    return NextResponse.json({ error: Messages.dvrNotConfigured }, { status: 409 });
  }

  // Development fixtures keep the calendar usable without a DVR. Ignored in
  // production by playbackMockAllowed, and the dates come from the same fixtures
  // the search route uses so the two never disagree.
  if (playbackMockAllowed(process.env)) {
    const dates = [...new Set(mockRecordings(camera, month).map((r) => r.startTime.slice(0, 10)))].sort();
    return NextResponse.json({ camera, month, dates, source: "mock" });
  }

  try {
    const dates = await recordingDatesCache.load(camera, month, () =>
      fetchRecordingDates(
        new HikvisionClient({
          host: config.dvrHost,
          port: config.dvrHttpPort,
          username: config.dvrUsername,
          password: config.dvrPassword,
          timeoutMs: 15000,
        }),
        camera,
        month,
      ),
    );
    return NextResponse.json({ camera, month, dates, source: "dvr" });
  } catch (error) {
    if (error instanceof HikvisionError) {
      if (error.code === "auth_failed") {
        return NextResponse.json({ error: Messages.dvrAuthFailed }, { status: 502 });
      }
      if (error.code === "offline") {
        return NextResponse.json({ error: Messages.playbackDvrOffline }, { status: 503 });
      }
      if (error.code === "not_configured") {
        return NextResponse.json({ error: Messages.dvrNotConfigured }, { status: 409 });
      }
      console.error("[recording-dates]", error.code, error.status ?? "");
      return NextResponse.json({ error: Messages.dvrUnexpected }, { status: 502 });
    }
    console.error("[recording-dates]", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: Messages.backendDown }, { status: 500 });
  }
}
