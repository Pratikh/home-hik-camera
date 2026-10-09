import { notFound } from "next/navigation";
import Link from "next/link";
import { getConfig } from "@/lib/config";
import { eventDurationSeconds, eventLabel, eventPlaybackHref, eventTitle } from "@/lib/events";
import { Messages } from "@/lib/messages";
import { formatKolkataClock } from "@/lib/time-kolkata";
import { getCameraNameMap } from "@/server/cameras/names";
import { openEventStore } from "@/server/events/event-store";
import { PageIntro } from "@/components/ui/States";
import { PriorityBadge } from "@/components/events/PriorityBadge";
import { SnapshotPanel } from "@/components/events/SnapshotPanel";
import { EventFacesPanel } from "@/components/events/EventFacesPanel";
import { MarkReadOnView } from "@/components/events/MarkReadOnView";

export const dynamic = "force-dynamic";

const EVENT_ID = /^evt_[a-f0-9]{24}$/;

export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!EVENT_ID.test(id)) notFound();

  const config = getConfig();
  const event = openEventStore(config.dataDir).get(id);
  if (!event) notFound();

  const names = await getCameraNameMap(config.dataDir);
  const cameraName = names[event.cameraId] ?? `Camera ${event.cameraId}`;
  const seconds = eventDurationSeconds(event.timestamp, event.endTimestamp);

  return (
    <div className="min-w-0 max-w-3xl">
      <PageIntro title={eventTitle(event.type, event.classification)} detail="Event detail from the DVR alarm log." />
      <MarkReadOnView eventId={event.id} />
      <article className="rounded-xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{cameraName}</h2>
            <p className="font-mono text-sm text-muted">{formatKolkataClock(new Date(event.timestamp))}</p>
          </div>
          <PriorityBadge priority={event.priority} />
        </div>

        <SnapshotPanel eventId={event.id} hasSnapshot={event.hasSnapshot} title={eventTitle(event.type, event.classification)} />

        {/*
          Face DETECTION only. It renders nothing when the feature is disabled,
          so an event detail page never reports "0 faces" for a feature that is
          switched off.
        */}
        <EventFacesPanel eventId={event.id} />

        <dl className="mt-4 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-sm">
          <dt className="text-muted">Time</dt><dd className="font-mono">{formatKolkataClock(new Date(event.timestamp))}</dd>
          <dt className="text-muted">Date</dt><dd className="font-mono">{event.timestamp.slice(0, 10)}</dd>
          <dt className="text-muted">Duration</dt><dd>{seconds === null ? Messages.notAvailable : `${seconds} seconds`}</dd>
          <dt className="text-muted">Type</dt><dd>{eventLabel(event.type, null)}</dd>
          <dt className="text-muted">Classification</dt><dd>{event.classification ? eventLabel(event.type, event.classification) : Messages.notAvailable}</dd>
          <dt className="text-muted">Priority</dt><dd>{event.priority}</dd>
          <dt className="text-muted">Confidence</dt><dd>{event.confidence === null ? Messages.notAvailable : `${Math.round(event.confidence * 100)}%`}</dd>
          <dt className="text-muted">Notification</dt><dd>{event.notified ? "Sent" : "Not sent"}</dd>
          <dt className="text-muted">Source</dt><dd>{event.source}</dd>
        </dl>

        <div className="mt-5 flex flex-wrap gap-2">
          <Link
            href={eventPlaybackHref(event)}
            className="inline-flex h-11 items-center rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f]"
          >
            View recording
          </Link>
          <Link href="/events" className="inline-flex h-11 items-center rounded-lg border border-line px-4 text-sm">
            Back to events
          </Link>
          <Link href="/notifications" className="inline-flex h-11 items-center rounded-lg border border-line px-4 text-sm">
            Notification history
          </Link>
        </div>
      </article>
    </div>
  );
}