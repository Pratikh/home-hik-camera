import { NextResponse } from "next/server";
import type { DetectionStatusResponse } from "@/lib/api-types";
import { getConfig } from "@/lib/config";
import { effectiveCameraDetection, OBJECT_DETECTION_MODEL, workerHeartbeatFresh } from "@/lib/object-detection";
import { objectDetectionConfig, readObjectWorkerHeartbeat } from "@/server/detection/settings-store";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only detection status for any signed-in user (VIEWER included).
 *
 * It exposes only the switches and the worker's own health numbers: no DVR
 * credentials, no token, no filesystem path. Changing anything stays ADMIN-only
 * on /api/settings/detection.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const dataDir = getConfig().dataDir;
  const store = openEventStore(dataDir);
  const config = objectDetectionConfig(dataDir);
  const worker = readObjectWorkerHeartbeat(store.db);
  const monitored = config.cameras.filter(
    (camera) => effectiveCameraDetection(config.settings, camera).enabled,
  ).length;

  const body: DetectionStatusResponse = {
    enabled: config.settings.enabled,
    monitoredCameras: monitored,
    personConfidence: config.settings.personConfidence,
    vehicleConfidence: config.settings.vehicleConfidence,
    worker,
    workerFresh: workerHeartbeatFresh(worker?.updatedAt ?? null, Date.now()),
    model: `${OBJECT_DETECTION_MODEL.name} ${OBJECT_DETECTION_MODEL.version}`,
  };
  return NextResponse.json(body);
}
