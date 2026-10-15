import type { DvrState, GatewayState, StreamMode } from "@/lib/api-types";
import { Messages } from "@/lib/messages";

export function hostName(hostHeader: string): string {
  const host = hostHeader.trim().toLowerCase();
  if (host.startsWith("[")) {
    const end = host.indexOf("]");
    return end > 1 ? host.slice(1, end) : host;
  }
  const firstColon = host.indexOf(":");
  if (firstColon > -1 && firstColon === host.lastIndexOf(":")) {
    return host.slice(0, firstColon);
  }
  return host;
}

export function selectPlaybackMode(input: {
  placeholder: boolean;
  dvr: DvrState;
  gateway: GatewayState;
  cameraOnline: boolean | null;
  requestHost: string;
  webrtcAdditionalHosts: string[];
}): { mode: StreamMode; message: string | null } {
  if (input.placeholder) {
    return { mode: "placeholder", message: Messages.placeholder };
  }
  if (input.dvr === "not_configured") return { mode: "unavailable", message: Messages.dvrNotConfigured };
  if (input.dvr === "auth_failed") return { mode: "unavailable", message: Messages.dvrAuthFailed };
  if (input.dvr !== "connected") return { mode: "unavailable", message: Messages.dvrOffline };
  if (input.gateway !== "connected") return { mode: "unavailable", message: Messages.gatewayDown };
  if (input.cameraOnline === false) return { mode: "unavailable", message: Messages.cameraUnavailable };

  const host = hostName(input.requestHost);
  const local = host === "localhost" || host === "127.0.0.1" || host === "::1";
  const advertised = input.webrtcAdditionalHosts.some((item) => item.toLowerCase() === host);
  /*
   * WebRTC only works when the browser can reach MediaMTX's ICE candidates, so
   * it is offered to localhost and to hosts that were explicitly advertised.
   * Every other host — a Cloudflare tunnel, a reverse proxy, a phone on another
   * network — gets the Hub's same-origin HLS instead. Merely configuring
   * WEBRTC_ADDITIONAL_HOST must not force WebRTC everywhere, because WebRTC
   * media cannot traverse an HTTPS tunnel.
   */
  if (local || advertised) return { mode: "webrtc", message: null };
  return { mode: "hls", message: Messages.liveHls };
}
