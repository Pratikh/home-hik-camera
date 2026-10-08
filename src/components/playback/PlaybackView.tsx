"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CameraView, CamerasResponse, PlaybackSearchResponse, RecordingView } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { eventOffsetMs, eventTitle, type CctvEvent } from "@/lib/events";
import { recordingToAutoplay, resolvePlaybackDate } from "@/lib/playback-date";
import { formatKolkataIso, kolkataDayBounds } from "@/lib/time-kolkata";
import { recordingAt, toTimelineSegment, zoomWindow, type TimelineSegment } from "@/lib/timeline";
import { PageIntro } from "@/components/ui/States";
import { PlaybackFilters } from "@/components/playback/PlaybackFilters";
import { PlaybackPlayer } from "@/components/playback/PlaybackPlayer";
import { PlaybackTimeline } from "@/components/playback/PlaybackTimeline";
import { RecordingList } from "@/components/playback/RecordingList";

const FALLBACK = [1, 2, 3, 4].map((id) => ({
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
  const [date, setDate] = useState(() => resolvePlaybackDate({ today: initialDate, selected: null, userChoseDate: false }));
  const [startTime, setStartTime] = useState("00:00");
  const [endTime, setEndTime] = useState("23:59");
  const [pending, setPending] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<RecordingView[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [playFrom, setPlayFrom] = useState<string | null>(null);
  const [playNonce, setPlayNonce] = useState(0);
  const [position, setPosition] = useState<number | null>(null);
  const [zoom, setZoom] = useState<24 | 6 | 1>(24);
  const [downloadNote, setDownloadNote] = useState<string | null>(null);
  const [pointNote, setPointNote] = useState<string | null>(null);
  const [empty, setEmpty] = useState(false);
  const [markers, setMarkers] = useState<{ id: string; offsetMs: number; label: string; classification: string | null }[]>([]);
  const eventSeekRef = useRef<{ camera: number; date: string; time: string } | null>(
    eventTime ? { camera: initialCamera, date: initialDate, time: eventTime } : null,
  );
  const requestSeq = useRef(0);
  const loadRef = useRef<(query: PlaybackQuery) => Promise<void>>(async () => undefined);
  const openedRef = useRef(false);
  const bootRef = useRef({ camera: initialCamera, date: initialDate });

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
    setEmpty(false);
    setPointNote(null);
    setDownloadNote(null);
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
        setMarkers(
          listed.events.flatMap((event) => {
            const offsetMs = eventOffsetMs(bounds.start.getTime(), event.timestamp);
            return offsetMs === null ? [] : [{ id: event.id, offsetMs, label: eventTitle(event.type, event.classification), classification: event.classification }];
          }),
        );
      }
      const seek = eventSeekRef.current;
      if (seek && seek.date === query.date && seek.camera === query.camera) {
        eventSeekRef.current = null;
        const instant = new Date(`${query.date}T${seek.time}+05:30`).getTime();
        const cover = recordingAt(body.recordings, instant);
        if (!cover) {
          setPointNote(Messages.recordingNotFound);
          setEmpty(body.recordings.length === 0);
          return;
        }
        const from = Math.max(instant, new Date(cover.startTime).getTime());
        playRecording(cover, formatKolkataIso(new Date(from)));
        return;
      }
      const autoplay = recordingToAutoplay(body.recordings);
      setEmpty(!autoplay);
      if (autoplay) playRecording(autoplay);
    } catch (error) {
      if (seq !== requestSeq.current || (error instanceof ApiError && error.status === 401)) return;
      setRecordings([]);
      setEmpty(false);
      setSearchError(error instanceof Error ? error.message : Messages.backendDown);
    } finally {
      if (seq === requestSeq.current) setPending(false);
    }
  }

  useEffect(() => {
    loadRef.current = load;
  });

  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    void loadRef.current({ camera: bootRef.current.camera, date: bootRef.current.date, startTime: "00:00", endTime: "23:59" });
  }, []);

  function chooseDate(next: string) {
    const resolved = resolvePlaybackDate({ today: initialDate, selected: next, userChoseDate: true });
    setDate(resolved);
    void load({ camera, date: resolved, startTime, endTime });
  }

  function seekDay(offsetMs: number) {
    if (!day) return;
    const instant = day.start.getTime() + offsetMs;
    const recording = recordingAt(recordings, instant);
    if (!recording) {
      setPointNote(Messages.noRecordingAtTime);
      return;
    }
    const from = Math.max(instant, new Date(recording.startTime).getTime());
    playRecording(recording, formatKolkataIso(new Date(from)));
  }

  async function download() {
    setDownloadNote(null);
    try {
      await api("/api/playback/download");
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return;
      setDownloadNote(error instanceof Error ? error.message : Messages.downloadUnavailable);
    }
  }

  return (
    <div className="min-w-0">
      <PageIntro title="CCTV Playback" detail="Today's recordings load on open. Choose another date to look further back." />
      <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="flex min-w-0 flex-col gap-4">
          <PlaybackFilters
            cameras={cameras}
            camera={camera}
            date={date}
            startTime={startTime}
            endTime={endTime}
            pending={pending}
            onCamera={setCamera}
            onDate={chooseDate}
            onStartTime={setStartTime}
            onEndTime={setEndTime}
            onSearch={() => void load({ camera, date, startTime, endTime })}
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
              onSeek={seekDay}
              events={markers}
            />
          ) : null}
          {pointNote ? <p className="text-sm text-muted">{pointNote}</p> : null}
        </div>
        <div className="flex min-w-0 flex-col gap-3">
          <RecordingList
            recordings={recordings}
            selectedId={selectedId}
            pending={pending}
            emptyMessage={!pending && empty ? Messages.noRecordings : null}
            onSelect={(recording) => playRecording(recording)}
          />
          <button
            type="button"
            disabled={!selected}
            onClick={() => void download()}
            className="h-11 rounded-lg border border-line bg-white/5 px-3 text-sm disabled:opacity-40"
          >
            Download selected recording
          </button>
          {downloadNote ? <p className="text-sm text-muted">{downloadNote}</p> : null}
        </div>
      </div>
    </div>
  );
}
