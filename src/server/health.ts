import type { DvrState, GatewayState, HealthBody, HealthDvrState } from "@/lib/api-types";

function healthDvr(state: DvrState): HealthDvrState {
  if (state === "connected" || state === "not_configured") return state;
  return "disconnected";
}

export async function buildHealth(deps: {
  appConfigured: boolean;
  loadDvr: () => Promise<DvrState>;
  loadGateway: () => Promise<GatewayState>;
}): Promise<{ httpStatus: number; body: HealthBody }> {
  const [dvr, videoGateway] = await Promise.all([
    deps.loadDvr().catch((error: unknown) => {
      console.error("[health] dvr", error instanceof Error ? error.name : "error");
      return "disconnected" as const;
    }),
    deps.loadGateway().catch((error: unknown) => {
      console.error("[health] gateway", error instanceof Error ? error.name : "error");
      return "disconnected" as const;
    }),
  ]);
  const body: HealthBody = {
    application: deps.appConfigured ? "ok" : "misconfigured",
    dvr: healthDvr(dvr),
    videoGateway,
    database: "ok",
    mediamtx: videoGateway === "connected" ? "ok" : "offline",
    events: "ok",
  };
  return { httpStatus: body.application === "ok" ? 200 : 503, body };
}
