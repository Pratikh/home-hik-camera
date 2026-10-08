import { Suspense } from "react";
import { EventsView } from "@/components/events/EventsView";
import { todayInKolkata } from "@/lib/time-kolkata";

export const dynamic = "force-dynamic";

export default function EventsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading events...</p>}>
      <EventsView initialDate={todayInKolkata()} />
    </Suspense>
  );
}
