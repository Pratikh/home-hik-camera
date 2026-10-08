export type DvrState = "connected" | "disconnected" | "not_configured" | "auth_failed";
export type GatewayState = "connected" | "disconnected";
export type HealthDvrState = "connected" | "disconnected" | "not_configured";

export type CameraView = {
  id: number;
  name: string;
  online: boolean | null;
  mainChannel: number;
  subChannel: number;
  mainPath: string;
  subPath: string;
};

export type CamerasResponse = {
  dvr: DvrState;
  dvrMessage: string;
  videoGateway: GatewayState;
  cameras: CameraView[];
};

export type DvrStatusResponse = {
  dvr: DvrState;
  message: string;
  videoGateway: GatewayState;
  checkedAt: string;
};

export type DeviceDetails = {
  name: string | null;
  model: string | null;
  serialNumber: string | null;
  firmware: string | null;
  encodingVersion: string | null;
  hardwareVersion: string | null;
  webVersion: string | null;
  pluginVersion: string | null;
  channelCount: number | null;
  hddCount: number | null;
  currentDeviceTime: string | null;
};

export type DvrInfoResponse = {
  dvr: DvrState;
  message: string;
  videoGateway: GatewayState;
  device: DeviceDetails | null;
  checkedAt: string;
};

export type StreamMode = "webrtc" | "hls" | "placeholder" | "unavailable";

export type StreamResponse = {
  path: string;
  channel: number | null;
  mode: StreamMode;
  message: string | null;
  whepUrl: string | null;
  hlsUrl: string | null;
};

export type SettingsResponse = {
  dvrHost: string;
  dvrHttpPort: number;
  dvrRtspPort: number;
  dvrUsername: string;
  dvrPasswordMask: string;
  webrtcAdditionalHost: string;
  videoDevPlaceholder: boolean;
  backend: "Connected";
  dvr: DvrState;
  dvrMessage: string;
  videoGateway: GatewayState;
};

export type HealthBody = {
  application: "ok" | "misconfigured";
  dvr: HealthDvrState;
  videoGateway: GatewayState;
  database: "ok" | "error";
  mediamtx: "ok" | "offline";
  events: "ok" | "stopped" | "error";
};

export type RecordingType = "continuous" | "motion" | "alarm" | "manual" | "other";

export type RecordingView = {
  id: string;
  camera: number;
  startTime: string;
  endTime: string;
  type: RecordingType | null;
  label: string;
};

export type PlaybackSearchResponse = {
  camera: number;
  cameraName: string;
  date: string;
  startTime: string;
  endTime: string;
  recordings: RecordingView[];
  downloadAvailable: false;
  downloadMessage: string;
};

export type PlaybackSessionResponse = {
  path: string;
  mode: StreamMode;
  message: string | null;
  whepUrl: string | null;
  hlsUrl: string | null;
  startTime: string;
  endTime: string;
};
