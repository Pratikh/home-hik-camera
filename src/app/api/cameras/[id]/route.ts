import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { CAMERA_COUNT } from "@/server/cameras/channels";
import { clearCameraName, CameraNameError, writeCameraName } from "@/server/cameras/store";
import { getCameraNameMap } from "@/server/cameras/names";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const cameraId = Number(id);
  if (!Number.isInteger(cameraId) || cameraId < 1 || cameraId > CAMERA_COUNT) {
    return NextResponse.json({ error: Messages.cameraUnavailable }, { status: 404 });
  }
  let name = "";
  let useDvrName = false;
  try {
    const body = (await request.json()) as { name?: unknown; useDvrName?: unknown };
    name = typeof body.name === "string" ? body.name : "";
    useDvrName = body.useDvrName === true;
  } catch {
    return NextResponse.json(
      { error: "Enter a camera name using letters, numbers, and spaces." },
      { status: 400 },
    );
  }
  try {
    const dataDir = getConfig().dataDir;
    // Clearing the override hands the display name back to the DVR channel name.
    if (useDvrName) {
      await clearCameraName(dataDir, cameraId);
      const names = await getCameraNameMap(dataDir);
      return NextResponse.json({ id: cameraId, name: names[cameraId] ?? `Camera ${cameraId}` });
    }
    const saved = await writeCameraName(dataDir, cameraId, name);
    return NextResponse.json({ id: cameraId, name: saved });
  } catch (error) {
    if (error instanceof CameraNameError) {
      return NextResponse.json(
        { error: "Enter a camera name using letters, numbers, and spaces." },
        { status: 400 },
      );
    }
    console.error("[cameras] save", error instanceof Error ? error.name : "error");
    return NextResponse.json({ error: Messages.backendDown }, { status: 500 });
  }
}
