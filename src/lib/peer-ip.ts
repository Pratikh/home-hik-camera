import { AsyncLocalStorage } from "node:async_hooks";
import http from "node:http";

/**
 * Request-scoped access to the TCP peer address.
 *
 * A Next.js route handler only receives a WHATWG `Request`, which exposes
 * request headers but not the socket. Next itself copies the peer address into
 * `x-forwarded-for` **only when the client did not send that header**
 * (`node_modules/next/dist/server/base-server.js`, `??= remoteAddress`), so once
 * a client sends `X-Forwarded-For` the header can no longer be told apart from
 * a trustworthy value.
 *
 * To make proxy-header trust verifiable, we capture the real peer address at the
 * Node HTTP layer, before Next merges headers. A patched `http.Server.prototype.emit`
 * runs every `request` event inside an `AsyncLocalStorage` scope; the scope is
 * inherited by the promise chain that handles the request, so route handlers and
 * server components can call `getPeerIp()` and get the authenticated socket
 * address instead of a client-controlled header.
 *
 * The store and the installation flag live on `globalThis` because Next loads
 * the instrumentation entry point and the route handlers through separate module
 * graphs; a module-local `instanceof` check would create two stores.
 *
 * Security properties:
 * - `getPeerIp()` is derived from the kernel, never from a header.
 * - The patch is idempotent and safe to load more than once (dev HMR, multiple
 *   workers); the original `emit` is called exactly once per event.
 * - It is a no-op in runtimes without `node:http` (edge), guarded by callers.
 */
export type RequestContext = { peerIp: string | null; encrypted: boolean };

const STORE_KEY = Symbol.for("home-cctv.peer-ip.store");
const INSTALLED_KEY = Symbol.for("home-cctv.peer-ip.installed");

type GlobalBag = Record<symbol, unknown>;

function globals(): GlobalBag {
  return globalThis as unknown as GlobalBag;
}

/** The `AsyncLocalStorage` holding the current request's socket address. */
export function peerIpStore(): AsyncLocalStorage<RequestContext> {
  const bag = globals();
  if (!bag[STORE_KEY]) {
    bag[STORE_KEY] = new AsyncLocalStorage<RequestContext>();
  }
  return bag[STORE_KEY] as AsyncLocalStorage<RequestContext>;
}

/**
 * The TCP peer address of the request currently being handled, or `null` when
 * called outside a request scope (for example from a timer or in a test).
 */
export function getPeerIp(): string | null {
  return peerIpStore().getStore()?.peerIp ?? null;
}

/**
 * Whether the request arrived over a TLS socket, or `null` outside a request
 * scope. This is the only trustworthy way to decide the `Secure` cookie flag for
 * a direct connection: `request.url` is built by Next from the (spoofable)
 * `X-Forwarded-Proto` header, not from the transport.
 */
export function getPeerEncrypted(): boolean | null {
  const store = peerIpStore().getStore();
  return store ? store.encrypted : null;
}

type EmitFunction = (...args: unknown[]) => boolean;

/**
 * Install the request-scope capture exactly once per process. Called from the
 * instrumentation entry point, which Next runs before it starts accepting
 * connections.
 */
export function installPeerIpCapture(): void {
  const bag = globals();
  if (bag[INSTALLED_KEY]) return;
  bag[INSTALLED_KEY] = true;

  const originalEmit = http.Server.prototype.emit as unknown as EmitFunction;

  http.Server.prototype.emit = function patchedEmit(
    this: http.Server,
    event: string | symbol,
    ...args: unknown[]
  ): boolean {
    if (event === "request") {
      const request = args[0] as http.IncomingMessage | undefined;
      const peerIp = request?.socket?.remoteAddress ?? null;
      const encrypted = Boolean((request?.socket as { encrypted?: boolean } | undefined)?.encrypted);
      return peerIpStore().run({ peerIp, encrypted }, () => originalEmit.apply(this, [event, ...args]));
    }
    return originalEmit.apply(this, [event, ...args]);
  } as typeof http.Server.prototype.emit;
}
