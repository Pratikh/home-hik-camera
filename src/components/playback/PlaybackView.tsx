"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CameraView, CamerasResponse, PlaybackSearchResponse, RecordingView } from "@/lib/api-types";
import { CAMERA_IDS } from "@/lib/cameras";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import type { CctvEvent } from "@/lib/events";
import { recordingToAutoplay, resolvePlaybackDate } from "@/lib/playback-date";
import { formatKolkataClock, formatKolkataIso, kolkataDayBounds } from "@/lib/time-kolkata";
import { recordingAt, toTimelineSegment, zoomWindow, type TimelineSegment } from "@/lib/timeline";
import { PageIntro } from "@/components/ui/States";
import { PlaybackFilters } from "@/components/playback/PlaybackFilters";
import {
  findNearestAvailableDate,
  monthOf,
  nearestRecorded,
  useRecordingDates,
} from "@/components/hooks/useRecordingDates";
import { PlaybackPlayer } from "@/components/playback/PlaybackPlayer";
import { PlaybackTimeline } from "@/components/playback/PlaybackTimeline";

const FALLBACK = CAMERA_IDS.map((id) => ({
  id,
  name: `Camera ${id}`,
  online: null,
  mainChannel: id * 100 + 1,
  subChannel: id * 100 + 2,
  mainPath: `cam${id}_main`,
  subPath: `cam${id}_sub`,
}));

type PlaybackQuery = { camera: number; date: string; startTime: string; endTime: string };

export function PlaybackView({
  initialDate,
  initialCamera = 1,
  eventTime = null,
}: {
  initialDate: string;
  initialCamera?: number;
  eventTime?: string | null;
}) {
  const [cameras, setCameras] = useState<CameraView[]>(FALLBACK);
  const [camera, setCamera] = useState(initialCamera);
  const [pickedDate, setPickedDate] = useState(() => resolvePlaybackDate({ today: initialDate, selected: null, userChoseDate: false }));
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  /*
   * The calendar's visible month. Availability is fetched per camera + month, so
   * paging months or switching camera issues exactly one request each.
   */
  const [month, setMonth] = useState(() => initialDate.slice(0, 7));
  const availability = useRecordingDates(camera, month);
  /* Launching from an event timestamp must not silently jump to another date. */
  const fromEvent = eventTime !== null;

  /*
   * The effective date is derived rather than synced: it is always a day this
   * camera has a recording on, when such a day exists in the month on screen.
   *
   * Deriving it keeps the displayed date and the played date identical without
   * an extra render, and means the calendar highlights exactly what will play.
   * Arriving from an event never re-routes: the requested date is kept so a
   * missing recording is reported instead of silently playing another day.
   */
  const date = useMemo(() => {
    if (fromEvent) return pickedDate;
    if (availability.status !== "ready") return pickedDate;
    if (availability.dates.includes(pickedDate)) return pickedDate;
    // Only correct within the month being browsed; another month is intentional.
    if (!pickedDate.startsWith(month)) return pickedDate;
    return nearestRecorded(availability.dates, pickedDate) ?? pickedDate;
  }, [availability.status, availability.dates, pickedDate, month, fromEvent]);

  const [pending, setPending] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordingView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playFrom, setPlayFrom] = useState<string | null>(null);
  const [playNonce, setPlayNonce] = useState(0);
  const [position, setPosition] = useState<number | null>(null);
  const [zoom, setZoom] = useState<24 | 6 | 1>(24);
  const [pointNote, setPointNote] = useState<string | null>(null);
  // Raw events for the day; markers are grouped from these so the grouping can
  // follow the zoom level without another network request.
  const [dayEvents, setDayEvents] = useState<CctvEvent[]>([]);
  const eventSeekRef = useRef<{ camera: number; date: string; time: string } | null>(
    eventTime ? { camera: initialCamera, date: initialDate, time: eventTime } : null,
  );
  const requestSeq = useRef(0);
  const loadRef = useRef<(query: PlaybackQuery) => Promise<void>>(async () => undefined);

  useEffect(() => {
    let ignore = false;
    void api<CamerasResponse>("/api/cameras")
      .then((body) => {
        if (!ignore && body.cameras.length > 0) setCameras(body.cameras);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 401) return;
      });
    return () => {
      ignore = true;
    };
  }, []);

  const day = kolkataDayBounds(date);
  const segments = useMemo<TimelineSegment[]>(() => {
    if (!day) return [];
    return recordings.flatMap((recording) => {
      const segment = toTimelineSegment(recording, day.start.getTime(), day.end.getTime());
      return segment ? [segment] : [];
    });
  }, [day, recordings]);

  const positionMs = day && position !== null ? position - day.start.getTime() : null;
  const focus = positionMs ?? 12 * 60 * 60 * 1000;
  const visible = zoomWindow(zoom, Math.min(Math.max(focus, 0), 24 * 60 * 60 * 1000 - 1));
  const selected = recordings.find((recording) => recording.id === selectedId) ?? null;
  /* No recordings for this day. Not the same as a failed search or a gap. */
  const noRecordings = !pending && !searchError && recordings.length === 0;

  function playRecording(recording: RecordingView, fromIso?: string) {
    setSelectedId(recording.id);
    setPointNote(null);
    setPlayFrom(fromIso ?? recording.startTime);
    setPlayNonce((value) => value + 1);
    setPosition(new Date(fromIso ?? recording.startTime).getTime());
  }

  async function load(query: PlaybackQuery) {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    setPending(true);
    setSearchError(null);
    setPointNote(null);
    setPlayFrom(null);
    setSelectedId(null);
    setPosition(null);
    try {
      const params = new URLSearchParams({
        camera: String(query.camera),
        date: query.date,
        startTime: query.startTime,
        endTime: query.endTime,
      });
      const body = await api<PlaybackSearchResponse>(`/api/playback/search?${params.toString()}`);
      if (seq !== requestSeq.current) return;
      setRecordings(body.recordings);
      const bounds = kolkataDayBounds(query.date);
      if (bounds) {
        const listed = await api<{ events: CctvEvent[] }>(
          `/api/events?camera=${query.camera}&date=${query.date}&startTime=00:00&endTime=23:59&pageSize=100`,
        ).catch(() => ({ events: [] as CctvEvent[] }));
        if (seq !== requestSeq.current) return;
        // Keep the raw events; the timeline groups them by available width.
        setDayEvents(listed.events);
      }
      const seek = eventSeekRef.current;
      if (seek && seek.date === query.date && seek.camera === query.camera) {
        eventSeekRef.current = null;
        const instant = new Date(`${query.date}T${seek.time}+05:30`).getTime();
        const cover = recordingAt(body.recordings, instant);
        if (!cover) {
          setPointNote(Messages.recordingNotFound);
          return;
        }
        const from = Math.max(instant, new Date(cover.startTime).getTime());
        playRecording(cover, formatKolkataIso(new Date(from)));
        return;
      }
      const autoplay = recordingToAutoplay(body.recordings);
      if (autoplay) playRecording(autoplay);
    } catch (error) {
      if (seq !== requestSeq.current || (error instanceof ApiError && error.status === 401)) return;
      setRecordings([]);
        setSearchError(error instanceof Error ? error.message : Messages.backendDown);
    } finally {
      if (seq === requestSeq.current) setPending(false);
    }
  }

  useEffect(() => {
    loadRef.current = load;
  });

  function chooseDate(next: string) {
    const resolved = resolvePlaybackDate({ today: initialDate, selected: next, userChoseDate: true });
    // The date drives the load effect, so playback and the calendar stay in step.
    loadedQuery.current = "";
    setPickedDate(resolved);
    setMonth(monthOf(resolved));
  }

  /*
   * One load per camera + date change, driven through the ref so the query always
   * uses the latest closure. A time-range edit is applied by the Search button
   * instead, so typing in those fields does not fire a request.
   */
  const loadedQuery = useRef("");
  /* Read the latest time range without making it an effect dependency. */
  const timeRange = useRef({ start: startTime, end: endTime });
  useEffect(() => {
    timeRange.current = { start: startTime, end: endTime };
  }, [startTime, endTime]);
  useEffect(() => {
    const key = `${camera}|${date}`;
    if (loadedQuery.current === key) return;
    loadedQuery.current = key;
    void loadRef.current({ camera, date, startTime: timeRange.current.start, endTime: timeRange.current.end });
  }, [camera, date]);

  /*
   * If the month on screen has no recordings at all, step back to the nearest
   * earlier month that does. The state update happens after the await, so it is
   * not a synchronous cascading render.
   */
  const backSearched = useRef("");
  useEffect(() => {
    if (fromEvent) return;
    if (availability.status !== "ready") return;
    if (availability.dates.length > 0) return;
    const key = `${camera}|${month}`;
    if (backSearched.current === key) return;
    backSearched.current = key;
    void findNearestAvailableDate(camera, pickedDate).then((found) => {
      if (!found) return;
      setPickedDate(found);
      setMonth(monthOf(found));
    });
  }, [availability.status, availability.dates, camera, month, pickedDate, fromEvent]);


  function seekDay(offsetMs: number) {
    if (!day) return;
    const instant = day.start.getTime() + offsetMs;
    const recording = recordingAt(recordings, instant);
    if (!recording) {
      // Name the exact time so the gap is unambiguous.
      setPointNote(`No recording at ${formatKolkataClock(new Date(instant))}`);
      return;
    }
    const from = Math.max(instant, new Date(recording.startTime).getTime());
    playRecording(recording, formatKolkataIso(new Date(from)));
  }

  return (
    /*
      One viewport-fitting column: the player takes the space left after the
      chrome and the timeline, so the timeline is never pushed below the fold.
      Mobile keeps natural flow and scrolls.
    */
    <div className="flex min-w-0 flex-col gap-3 md:h-full md:min-h-0">
      <PageIntro
        compact
        title="CCTV Playback"
        detail="Today's recordings load on open. Choose a date, then scrub the timeline."
      />
      <PlaybackFilters
        cameras={cameras}
        camera={camera}
        date={date}
        startTime={startTime}
        endTime={endTime}
        pending={pending}
        month={month}
        recorded={availability.dates}
        availabilityStatus={availability.status}
        availabilityError={availability.error}
        onCamera={setCamera}
        onStartTime={setStartTime}
        onEndTime={setEndTime}
        onSearch={() => void load({ camera, date, startTime, endTime })}
        onMonthChange={setMonth}
        onDate={chooseDate}
        onReloadAvailability={availability.reload}
      />
      {searchError ? (
        <p className="text-sm text-warn" role="status">
          {searchError}
        </p>
      ) : null}
      <PlaybackPlayer
        camera={camera}
        bounds={selected ? { start: selected.startTime, end: selected.endTime } : null}
        playFrom={playFrom}
        playNonce={playNonce}
        onPosition={setPosition}
      />
      {day ? (
        <PlaybackTimeline
          dayStartMs={day.start.getTime()}
          segments={segments}
          window={visible}
          positionMs={positionMs}
          zoom={zoom}
          onZoom={setZoom}
          /* Dragging previews locally; this runs once when the gesture ends. */
          onSeek={seekDay}
          events={dayEvents}
          cameraName={cameras.find((item) => item.id === camera)?.name}
        />
      ) : null}
      {noRecordings ? <p className="text-sm text-muted">{Messages.noRecordings}</p> : null}
      {pointNote ? <p className="text-sm text-muted">{pointNote}</p> : null}
    </div>
  );
}
