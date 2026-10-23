import type { Metadata } from "next";
import { DetectionSettings } from "@/components/settings/DetectionSettings";

export const metadata: Metadata = { title: "Object detection" };

export default function DetectionSettingsPage() {
  return <DetectionSettings />;
}
