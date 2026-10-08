import type { Metadata } from "next";
import { DeviceView } from "@/components/device/DeviceView";

export const metadata: Metadata = { title: "Device" };

export default function DevicePage() {
  return <DeviceView />;
}
