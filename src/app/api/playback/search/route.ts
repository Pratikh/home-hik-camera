import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { mockRecordings, parseSearchParams, playbackMockAllowed, DOWNLOAD_UNAVAILABLE } from "@/lib/recording";
import { getCameraNameMap } from "@/server/cameras/names";
import { requireUser } from "@/server/http/require-user";
import { HikvisionClient } from "@/server/hikvision/hikvision-client";
import { playbackClientFrom } from "@/server/hikvision/hikvision-playback";
import { HikvisionError } from "@/server/hikvision/hikvision-types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function failure(error: unknown): NextResponse {
  if (error instanceof HikvisionError) {
    if (error.code === "not_configured") {
      return NextResponse.json({ error: Messages.dvrNotConfigured }, { status: 409 });
    }
    if (error.code === "auth_failed") {
      return NextResponse.json({ error: Messages.dvrAuthFailed }, { status: 502 });
    }
    if (error.code === "offline") {
      return NextResponse.json({ error: Messages.playbackDvrOffline }, { status: 503 });
    }
    const message = error.message === Messages.playbackUnavailable ? Messages.playbackUnavailable : Messages.dvrUnexpected;
    return NextResponse.json({ error: message }, { status: 502 });
  }
  console.error("[playback] search", error instanceof Error ? error.name : "error");
  return NextResponse.json({ error: Messages.backendDown }, { status: 500 });
}

export async function GET(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const parsed = parseSearchParams({
    camera: url.searchParams.get("camera"),
    date: url.searchParams.get("date"),
    startTime: url.searchParams.get("startTime"),
    endTime: url.searchParams.get("endTime"),
  });
  if (!parsed.ok) return NextResponse.json({ error: parsed.message }, { status: 400 });

  try {
    const config = getConfig();
    const names = await getCameraNameMap(config.dataDir);
    const recordings = playbackMockAllowed(process.env)
      ? mockRecordings(parsed.query.camera, parsed.query.date)
      : await playbackClientFrom(
          new HikvisionClient({
            host: config.dvrHost,
            port: config.dvrHttpPort,
            username: config.dvrUsername,
            password: config.dvrPassword,
            timeoutMs: 12000,
          }),
          {
            host: config.dvrHost,
            port: config.dvrRtspPort,
            username: config.dvrUsername,
            password: config.dvrPassword,
          },
        ).searchRecordings(parsed.query);

    return NextResponse.json({
      camera: parsed.query.camera,
      cameraName: names[parsed.query.camera] ?? `Camera ${parsed.query.camera}`,
      date: parsed.query.date,
      startTime: parsed.query.startTime,
      endTime: parsed.query.endTime,
      recordings,
      downloadAvailable: DOWNLOAD_UNAVAILABLE.available,
      downloadMessage: DOWNLOAD_UNAVAILABLE.message,
    });
  } catch (error) {
    return failure(error);
  }
}
