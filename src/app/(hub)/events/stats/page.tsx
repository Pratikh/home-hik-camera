import type { Metadata } from "next";
import { EventStatsView } from "@/components/events/EventStatsView";

export const metadata: Metadata = { title: "Event statistics" };
export const dynamic = "force-dynamic";

export default function EventStatsPage() {
  return <EventStatsView />;
}