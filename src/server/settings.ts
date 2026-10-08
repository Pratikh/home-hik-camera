import type { AppConfig } from "@/lib/config";

export function maskSettings(config: AppConfig) {
  return {
    dvrHost: config.dvrHost,
    dvrHttpPort: config.dvrHttpPort,
    dvrRtspPort: config.dvrRtspPort,
    dvrUsername: config.dvrUsername,
    dvrPasswordMask: "********",
    webrtcAdditionalHost: config.webrtcAdditionalHosts.join(", "),
    videoDevPlaceholder: config.videoDevPlaceholder,
  };
}
