import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { CAMERA_COUNT } from "@/server/cameras/channels";
import { CameraNameError, writeCameraName } from "@/server/cameras/store";
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
  try {
    const body = (await request.json()) as { name?: unknown };
    name = typeof body.name === "string" ? body.name : "";
  } catch {
    return NextResponse.json(
      { error: "Enter a camera name using letters, numbers, and spaces." },
      { status: 400 },
    );
  }
  try {
    const saved = await writeCameraName(getConfig().dataDir, cameraId, name);
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
