import type { Metadata } from "next";
import { CamerasView } from "@/components/cameras/CamerasView";

export const metadata: Metadata = { title: "Cameras" };

export default function CamerasPage() {
  return <CamerasView />;
}
