import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { cameraChannels } from "@/server/cameras/channels";
import { readCameraNames } from "@/server/cameras/store";
import { requireUser } from "@/server/http/require-user";
import { getDvrOverview } from "@/server/hikvision/hikvision-status";
import { getVideoGatewayState } from "@/server/video/mediamtx";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  try {
    const config = getConfig();
    const [names, overview, videoGateway] = await Promise.all([
      readCameraNames(config.dataDir),
      getDvrOverview(),
      getVideoGatewayState(),
    ]);
    const cameras = cameraChannels().map((camera) => {
      const reported = overview.channels?.find((channel) => channel.id === camera.id);
      return {
        id: camera.id,
        name: names[camera.id] ?? `Camera ${camera.id}`,
        online: reported?.online ?? null,
        mainChannel: camera.mainChannel,
        subChannel: camera.subChannel,
        mainPath: camera.mainPath,
        subPath: camera.subPath,
      };
    });
    return NextResponse.json({
      dvr: overview.state,
      dvrMessage: overview.message,
      videoGateway,
      cameras,
    });
  } catch (error) {
    console.error("[cameras]", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: Messages.backendDown }, { status: 500 });
  }
}
