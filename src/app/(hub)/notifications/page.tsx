import { Suspense } from "react";
import { NotificationsView } from "@/components/events/NotificationsView";
import { todayInKolkata } from "@/lib/time-kolkata";

export const dynamic = "force-dynamic";

export default function NotificationsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-muted">Loading notifications...</p>}>
      <NotificationsView initialDate={todayInKolkata()} />
    </Suspense>
  );
}