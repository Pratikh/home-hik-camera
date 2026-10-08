import "server-only";
import { getConfig } from "@/lib/config";
import { describePlaybackPath } from "@/server/cameras/channels";

const tails = new Map<string, Promise<unknown>>();
const currentToken = new Map<string, string>();
const LEFTOVER_PATHS = ["pb1", "pb2", "pb3", "pb4"];

function enqueue(pathName: string, task: () => Promise<void>): Promise<void> {
  const previous = tails.get(pathName) ?? Promise.resolve();
  const run = previous.then(task, task);
  tails.set(
    pathName,
    run.then(
      () => undefined,
      () => undefined,
    ),
  );
  return run;
}

async function mediamtx(pathName: string, method: "DELETE" | "POST", body?: string): Promise<Response> {
  const config = getConfig();
  return fetch(`${config.mediamtxApiUrl}/v3/config/paths/${method === "DELETE" ? "delete" : "add"}/${pathName}`, {
    method,
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body,
    signal: AbortSignal.timeout(8000),
  });
}

async function pathHasMedia(pathName: string): Promise<boolean> {
  const config = getConfig();
  try {
    const response = await fetch(`${config.mediamtxApiUrl}/v3/paths/get/${pathName}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) return false;
    const body = (await response.json()) as { ready?: boolean; bytesReceived?: number };
    return body.ready === true && (body.bytesReceived ?? 0) > 0;
  } catch {
    return false;
  }
}

export async function publishPlaybackSource(pathName: string, source: string, token: string): Promise<void> {
  if (!describePlaybackPath(pathName)) throw new Error("invalid playback path");
  await enqueue(pathName, async () => {
    currentToken.set(pathName, token);
    for (const leftover of LEFTOVER_PATHS) {
      await mediamtx(leftover, "DELETE").catch(() => undefined);
    }
    const removed = await mediamtx(pathName, "DELETE");
    if (!removed.ok && removed.status !== 404) {
      console.error("[playback] path delete", pathName, removed.status);
      throw new Error("gateway");
    }
    const added = await mediamtx(
      pathName,
      "POST",
      JSON.stringify({
        source,
        sourceOnDemand: false,
        rtspTransport: "tcp",
      }),
    );
    if (!added.ok) {
      console.error("[playback] path add", pathName, added.status);
      throw new Error("gateway");
    }
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      if (currentToken.get(pathName) !== token) return;
      if (await pathHasMedia(pathName)) return;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
    if (currentToken.get(pathName) === token) {
      await mediamtx(pathName, "DELETE").catch(() => undefined);
      currentToken.delete(pathName);
    }
    throw new Error("not_ready");
  });
}

export async function closePlaybackSource(pathName: string, token?: string): Promise<void> {
  if (!describePlaybackPath(pathName)) return;
  await enqueue(pathName, async () => {
    if (token && currentToken.get(pathName) !== token) return;
    currentToken.delete(pathName);
    try {
      const removed = await mediamtx(pathName, "DELETE");
      if (!removed.ok && removed.status !== 404) {
        console.error("[playback] path close", pathName, removed.status);
      }
    } catch (error) {
      console.error("[playback] path close", error instanceof Error ? error.name : "error");
    }
  });
}
