import type { Metadata } from "next";
import { CamerasView } from "@/components/cameras/CamerasView";

export const metadata: Metadata = { title: "Camera setup" };

export default function CamerasPage() {
  return <CamerasView />;
}
