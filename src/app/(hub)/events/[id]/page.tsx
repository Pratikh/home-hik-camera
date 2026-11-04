import { notFound } from "next/navigation";
import Link from "next/link";
import { getConfig } from "@/lib/config";
import { eventDurationSeconds, eventLabel, eventPlaybackHref, eventTitle } from "@/lib/events";
import { Messages } from "@/lib/messages";
import { priorityLabel } from "@/lib/priority";
import { formatKolkataClock, formatKolkataDateTimeFromIso } from "@/lib/time-kolkata";
import { getCameraNameMap } from "@/server/cameras/names";
import { openEventStore } from "@/server/events/event-store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";
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
  const store = openEventStore(config.dataDir);
  const event = store.get(id);
  if (!event) notFound();

  // AI detections carry their detector metadata (raw class, confidence,
  // threshold, bounding box). DVR events have none, so the box is simply absent.
  const metadata = store.eventMetadata(event.id);
  const detection =
    metadata && typeof metadata.detection === "object" && metadata.detection !== null
      ? (metadata.detection as Record<string, unknown>)
      : null;
  const boundingBox =
    detection && typeof detection.boundingBox === "object" && detection.boundingBox !== null
      ? (detection.boundingBox as Record<string, unknown>)
      : null;
  const numberOrNull = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

  const names = await getCameraNameMap(config.dataDir);
  const cameraName = names[event.cameraId] ?? `Camera ${event.cameraId}`;
  const seconds = eventDurationSeconds(event.timestamp, event.endTimestamp);
  const title = eventTitle(event.type, event.classification);
  const when = formatKolkataDateTimeFromIso(event.timestamp);
  const dateText = when.split(",")[0] ?? event.timestamp.slice(0, 10);
  const clock = formatKolkataClock(new Date(event.timestamp));
  const durationText = seconds === null ? Messages.notAvailable : `${seconds} seconds`;
  const threshold = numberOrNull(detection?.threshold ?? null);

  // Only real, stored times are listed — the context card never invents a row.
  const context: { time: string; text: string }[] = [];
  if (event.recordingStart) {
    context.push({ time: formatKolkataClock(new Date(event.recordingStart)), text: "Recording segment starts" });
  }
  context.push({
    time: clock,
    text: `${title}${event.confidence === null ? "" : ` · ${Math.round(event.confidence * 100)}% confidence`}`,
  });
  if (event.endTimestamp) {
    context.push({ time: formatKolkataClock(new Date(event.endTimestamp)), text: "Event ends" });
  }
  if (event.recordingEnd) {
    context.push({ time: formatKolkataClock(new Date(event.recordingEnd)), text: "Recording segment ends" });
  }

  return (
    <div className="min-w-0">
      <nav className="breadcrumb" aria-label="Breadcrumb">
        <Link href="/events">Events</Link>
        <span aria-hidden="true">/</span>
        <span>{title}</span>
      </nav>

      <PageHeader
        eyebrow="Investigate"
        title={title}
        detail={`${cameraName} · ${when} · ${durationText} · ${priorityLabel(event.priority)} priority`}
        actions={
          <>
            <Link href="/events" className="btn">
              <Icon name="chevronLeft" className="icon icon-sm" />
              Back to events
            </Link>
            <Link href={eventPlaybackHref(event)} className="btn btn--primary">
              <Icon name="playback" className="icon icon-sm" />
              View recording
            </Link>
          </>
        }
      />

      <MarkReadOnView eventId={event.id} />

      <div className="detail-hero">
        <div>
          <SnapshotPanel
            key={event.id}
            eventId={event.id}
            hasSnapshot={event.hasSnapshot}
            title={title}
            timestampLabel={when}
            cameraLabel={`Camera ${event.cameraId}`}
            detection={
              detection
                ? {
                    rawClass: typeof detection.rawClass === "string" ? detection.rawClass : null,
                    classification: typeof detection.classification === "string" ? detection.classification : null,
                    confidence: numberOrNull(detection.confidence),
                    x: boundingBox ? numberOrNull(boundingBox.x) : null,
                    y: boundingBox ? numberOrNull(boundingBox.y) : null,
                    width: boundingBox ? numberOrNull(boundingBox.width) : null,
                    height: boundingBox ? numberOrNull(boundingBox.height) : null,
                  }
                : null
            }
          />

          <section className="card mt-4" aria-label="Recording context">
            <div className="card__head">
              <div className="card__title">
                <Icon name="playback" className="icon icon-sm" />
                Recording context
              </div>
              <span className="chip chip--mono">{durationText}</span>
            </div>
            <div className="card__body">
              <div className="timeline-mini">
                {context.map((row, index) => (
                  <div key={`${row.time}-${index}`} className="timeline-mini__row">
                    <span className="timeline-mini__t">{row.time}</span>
                    <span className="timeline-mini__d">{row.text}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card__foot flex items-center justify-between gap-3">
              <span className="section__hint">H.264 sub stream · 704×576</span>
              <Link href={eventPlaybackHref(event)} className="btn btn--sm">
                Open in playback
                <Icon name="arrowRight" className="icon icon-sm" />
              </Link>
            </div>
          </section>
        </div>

        <div className="detail-side">
          <section className="card" aria-label="Event summary">
            <div className="card__head">
              <div className="card__title">
                <Icon name="file" className="icon icon-sm" />
                Event summary
              </div>
              <PriorityBadge priority={event.priority} />
            </div>
            <div className="card__body">
              <dl className="prop-list">
                <dt>Camera</dt>
                <dd>{cameraName}</dd>
                <dt>Time</dt>
                <dd className="mono">{clock}</dd>
                <dt>Date</dt>
                <dd className="mono">{dateText}</dd>
                <dt>Duration</dt>
                <dd>{durationText}</dd>
                <dt>Type</dt>
                <dd>{eventLabel(event.type, null)}</dd>
                <dt>Classification</dt>
                <dd>{event.classification ? eventLabel(event.type, event.classification) : Messages.notAvailable}</dd>
                <dt>Priority</dt>
                <dd>
                  <PriorityBadge priority={event.priority} />
                </dd>
                <dt>Confidence</dt>
                <dd>{event.confidence === null ? Messages.notAvailable : `${Math.round(event.confidence * 100)}%`}</dd>
                <dt>Notification</dt>
                <dd>{event.notified ? "Sent" : "Not sent"}</dd>
                <dt>Source</dt>
                <dd className="mono">{event.source}</dd>
              </dl>
            </div>
            <div className="card__foot">
              <span className="section__hint">
                Event ID <span className="font-mono text-ink-2">{event.id}</span>
              </span>
            </div>
          </section>

          {/* Face DETECTION only. It renders nothing when the feature is
              disabled, so an event detail page never reports "0 faces" for a
              feature that is switched off. */}
          <EventFacesPanel eventId={event.id} />

          <section className="card" aria-label="Technical details">
            <div className="card__head">
              <div className="card__title">
                <Icon name="cpu" className="icon icon-sm" />
                Technical details
              </div>
            </div>
            <div className="card__body">
              <dl className="kv-grid">
                <div className="kv">
                  <dt>Source</dt>
                  <dd className="mono">{event.source}</dd>
                </div>
                <div className="kv">
                  <dt>Priority</dt>
                  <dd>{priorityLabel(event.priority)}</dd>
                </div>
                {detection ? (
                  <>
                    <div className="kv">
                      <dt>Detector</dt>
                      <dd>{String(detection.detector ?? "object-detection")}</dd>
                    </div>
                    {typeof detection.model === "string" ? (
                      <div className="kv">
                        <dt>Model</dt>
                        <dd className="mono">{detection.model}</dd>
                      </div>
                    ) : null}
                    <div className="kv">
                      <dt>Raw class</dt>
                      <dd>{String(detection.rawClass ?? Messages.notAvailable)}</dd>
                    </div>
                    <div className="kv">
                      <dt>Threshold</dt>
                      <dd>{threshold === null ? Messages.notAvailable : `${Math.round(threshold * 100)}%`}</dd>
                    </div>
                    <div className="kv">
                      <dt>Track</dt>
                      <dd className="mono">{String(detection.trackId ?? Messages.notAvailable)}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
