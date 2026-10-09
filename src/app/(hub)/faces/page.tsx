import type { Metadata } from "next";
import { FacesView } from "@/components/faces/FacesView";

export const metadata: Metadata = { title: "Detected Faces" };

/**
 * `/faces` renders even when face detection is off: the view reports the
 * disabled state from `/api/faces` rather than the page failing to build.
 */
export default function FacesPage() {
  return <FacesView />;
}
