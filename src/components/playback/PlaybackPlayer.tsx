"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlaybackSessionResponse } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { formatKolkataClock, formatKolkataIso } from "@/lib/time-kolkata";
import { startHls, startWhep } from "@/components/camera/LivePlayer";
import { FrameSkeleton, MessagePanel } from "@/components/ui/States";
import { PlaybackControls } from "@/components/playback/PlaybackControls";

type Phase = "idle" | "connecting" | "loading" | "playing" | "paused" | "ended" | "error" | "gesture";

type Run = { start: string; end: string; nonce: number };

const SEEK_MS = 15_000;

export function PlaybackPlayer({
  camera,
  bounds,
  playFrom,
  playNonce,
  onPosition,
}: {
  camera: number;
  bounds: { start: string; end: string } | null;
  playFrom: string | null;
  playNonce: number;
  onPosition: (epochMs: number | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const onPositionRef = useRef(onPosition);
  /*
   * The <video> node is mirrored into state so the start effect re-runs once the
   * element attaches. Reading only the ref raced hydration on the first load,
   * leaving the player blank until a reload.
   */
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  /*
   * Real media aspect ratio, read from the element once metadata arrives. The
   * sub streams are 704x576 (~1.22:1), not 16:9, so assuming a ratio either
   * stretches the picture or surrounds it with bars. Null until known, which
   * lets the stage simply fill the frame for the idle and error states.
   */
  const [aspect, setAspect] = useState<number | null>(null);
  const attachVideo = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    setVideo(node);
  }, []);
  const [phase, setPhase] = useState<Phase>("idle");
  const [detail, setDetail] = useState("Choose a recording");
  const [muted, setMuted] = useState(true);
  const [volume, setVolume] = useState(1);
  const [override, setOverride] = useState<{ nonce: number; run: Run | null } | null>(null);
  const [tick, setTick] = useState<{ nonce: number; label: string } | null>(null);
  const positionRef = useRef<number | null>(null);
  const playingRef = useRef(false);
  const clockRef = useRef({ base: 0, started: 0 });
  const requested: Run | null =
    bounds && playFrom ? { start: playFrom, end: bounds.end, nonce: playNonce } : null;
  const run = override && requested && override.nonce === playNonce ? override.run : requested;
  const runStart = run?.start ?? null;
  const runEnd = run?.end ?? null;
  const runNonce = run?.nonce ?? null;
  const clock =
    tick && runNonce !== null && tick.nonce === runNonce
      ? tick.label
      : runStart
        ? formatKolkataClock(new Date(runStart))
        : (tick?.label ?? "--:--:--");

  useEffect(() => {
    onPositionRef.current = onPosition;
  }, [onPosition]);

  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    node.muted = muted;
    node.volume = volume;
  }, [muted, volume, video]);

  useEffect(() => {
    if (!runStart || !runEnd || runNonce === null) return;
    if (!video) return;
    const abort = new AbortController();
    const bag: { pc?: RTCPeerConnection; hls?: { destroy: () => void }; session?: string | null } = {};
    let stopped = false;
    const origin = new Date(runStart).getTime();
    const end = new Date(runEnd).getTime();
    const token = String(runNonce);
    positionRef.current = origin;
    playingRef.current = false;
    clockRef.current = { base: origin, started: 0 };

    const stopGateway = () => {
      void fetch(`/api/playback/session?camera=${camera}&token=${token}`, {
        method: "DELETE",
        credentials: "same-origin",
        keepalive: true,
      });
    };

    const armClock = () => {
      clockRef.current = { base: positionRef.current ?? origin, started: Date.now() };
      playingRef.current = true;
    };

    const runStream = async () => {
      setPhase("connecting");
      setDetail(Messages.connectingDvr);
      let session: PlaybackSessionResponse | null = null;
      /*
       * This DVR serves one playback stream. The background preview generator
       * checks before it takes it and stands down, but it can already be a second
       * into an extraction when the player asks — so losing that race must not
       * surface as an error. Two short retries outlast one extraction (~2.3 s);
       * everything else fails as before.
       */
      for (let attempt = 0; attempt < 3 && !stopped; attempt += 1) {
        try {
          session = await api<PlaybackSessionResponse>("/api/playback/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ camera, startTime: runStart, endTime: runEnd, token }),
          });
          break;
        } catch (error) {
          if (stopped || (error instanceof ApiError && error.status === 401)) return;
          const contended = error instanceof ApiError && (error.status === 503 || error.status === 502);
          if (!contended || attempt === 2) {
            setDetail(error instanceof Error ? error.message : Messages.backendDown);
            setPhase("error");
            playingRef.current = false;
            return;
          }
          setDetail(Messages.connectingDvr);
          await new Promise((resolve) => setTimeout(resolve, 1200));
        }
      }
      if (stopped || !session) return;
      if (session.mode === "unavailable" || (!session.whepUrl && !session.hlsUrl)) {
        setDetail(session.message ?? Messages.playbackUnavailable);
        setPhase("error");
        playingRef.current = false;
        return;
      }

      const playHls = async () => {
        if (!session.hlsUrl) throw new Error("hls_missing");
        setDetail(Messages.buffering);
        setPhase("loading");
        bag.hls = await startHls(video, session.hlsUrl, abort.signal);
      };

      try {
        setPhase("loading");
        setDetail(Messages.loadingPlayback);
        if (session.mode === "hls") {
          await playHls();
        } else if (session.whepUrl) {
          let connected = false;
          for (let attempt = 0; attempt < 3 && !connected; attempt += 1) {
            try {
              const whep = await startWhep(video, session.whepUrl, abort.signal);
              bag.pc = whep.pc;
              bag.session = whep.location;
              connected = true;
            } catch (error) {
              if (stopped || (error instanceof Error && error.name === "AbortError")) return;
              bag.pc?.close();
              bag.pc = undefined;
              if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 500));
            }
          }
          if (!connected) await playHls();
        }
        if (stopped) return;
        try {
          await video.play();
        } catch {
          setPhase("gesture");
          setDetail(Messages.loadingPlayback);
          return;
        }
        armClock();
        setPhase("playing");
        setDetail("");
      } catch (error) {
        if (stopped || (error instanceof Error && error.name === "AbortError")) return;
        setDetail(Messages.playbackUnavailable);
        setPhase("error");
        playingRef.current = false;
      }
    };

    void runStream();
    const timer = window.setInterval(() => {
      if (!playingRef.current || clockRef.current.started === 0) return;
      const next = Math.min(end, clockRef.current.base + (Date.now() - clockRef.current.started));
      positionRef.current = next;
      setTick({ nonce: runNonce, label: formatKolkataClock(new Date(next)) });
      onPositionRef.current(next);
      if (next >= end) {
        playingRef.current = false;
        setPhase("ended");
        setDetail("Playback finished");
        abort.abort();
        bag.pc?.close();
        bag.hls?.destroy();
        stopGateway();
      }
    }, 250);

    return () => {
      stopped = true;
      playingRef.current = false;
      abort.abort();
      bag.pc?.close();
      bag.hls?.destroy();
      if (bag.session) {
        void fetch(bag.session, { method: "DELETE", credentials: "same-origin", keepalive: true });
      }
      stopGateway();
      video.srcObject = null;
      video.removeAttribute("src");
      window.clearInterval(timer);
    };
  }, [camera, runStart, runEnd, runNonce, video]);

  function jump(deltaMs: number) {
    if (!bounds || positionRef.current === null) return;
    const start = new Date(bounds.start).getTime();
    const end = new Date(bounds.end).getTime();
    const next = Math.min(end - 1000, Math.max(start, positionRef.current + deltaMs));
    if (next === positionRef.current) return;
    positionRef.current = next;
    onPosition(next);
    setOverride({
      nonce: playNonce,
      run: { start: formatKolkataIso(new Date(next)), end: bounds.end, nonce: Date.now() },
    });
  }

  function toggle() {
    if (!bounds || positionRef.current === null) return;
    if (phase === "playing" || phase === "loading" || phase === "connecting") {
      playingRef.current = false;
      setPhase("paused");
      setDetail("Paused");
      setOverride({ nonce: playNonce, run: null });
      return;
    }
    if (phase === "paused" || phase === "ended" || phase === "error" || phase === "gesture") {
      const startMs = Math.min(new Date(bounds.end).getTime() - 1000, positionRef.current);
      setOverride({
        nonce: playNonce,
        run: { start: formatKolkataIso(new Date(startMs)), end: bounds.end, nonce: Date.now() },
      });
    }
  }

  function fullscreen() {
    const node = frameRef.current;
    if (!node) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void node.requestFullscreen();
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      }
      if (event.key === " ") {
        event.preventDefault();
        toggle();
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        jump(-SEEK_MS);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        jump(SEEK_MS);
      } else if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        fullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const visiblePhase: Phase = !run && phase !== "paused" && phase !== "error" ? "idle" : phase;
  const showVideo =
    visiblePhase === "playing" ||
    visiblePhase === "paused" ||
    visiblePhase === "gesture" ||
    visiblePhase === "loading" ||
    visiblePhase === "ended";
  // Controls that cannot do anything must be disabled: without a recording
  // bound, and while the stream is in the error state.
  const controlsDisabled = !bounds || visiblePhase === "error";

  function retry() {
    if (!bounds) return;
    const startMs = Math.min(new Date(bounds.end).getTime() - 1000, positionRef.current ?? new Date(bounds.start).getTime());
    setOverride({
      nonce: playNonce,
      run: { start: formatKolkataIso(new Date(startMs)), end: bounds.end, nonce: Date.now() },
    });
  }

  return (
    <section className="flex min-w-0 flex-col md:min-h-0 md:flex-1" aria-label="Playback">
      <div
        ref={frameRef}
        className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-xl border border-line bg-black md:aspect-auto md:min-h-0 md:flex-1 md:basis-0"
      >
        {/*
          The stage takes the stream's own ratio, driven by the frame's height.
          Because the frame is height-limited on desktop, the stage hugs the
          picture instead of leaving wide black bars; on a narrow window
          `max-w-full` clamps it and the video letterboxes vertically instead.
        */}
        <div
          className="relative h-full max-h-full w-full max-w-full"
          style={aspect ? { width: "auto", aspectRatio: `${aspect}` } : undefined}
          >
          <video
            ref={attachVideo}
            className={`h-full w-full object-contain ${showVideo ? "block" : "hidden"}`}
            playsInline
            muted={muted}
            aria-label="Recording playback"
            onLoadedMetadata={(event) => {
              const node = event.currentTarget;
              if (node.videoWidth > 0 && node.videoHeight > 0) {
                setAspect(node.videoWidth / node.videoHeight);
              }
            }}
          />
          {visiblePhase === "connecting" || visiblePhase === "loading" ? (
            <div className="absolute inset-0">
              <FrameSkeleton />
              <p className="absolute inset-x-0 bottom-4 text-center text-sm text-white/80">{detail}</p>
            </div>
          ) : null}
          {visiblePhase === "idle" ? <MessagePanel message="Choose a recording" /> : null}
          {visiblePhase === "error" ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-4 text-center">
              {/* State the cause rather than a bare "unavailable". */}
              <p className="text-sm text-white/90">{detail ?? Messages.playbackUnavailable}</p>
              <button
                type="button"
                onClick={retry}
                disabled={!bounds}
                className="h-10 rounded-lg border border-white/30 px-4 text-sm text-white hover:bg-white/10 disabled:opacity-40"
              >
                Retry
              </button>
            </div>
          ) : null}
          {visiblePhase === "gesture" ? (
            <button
              type="button"
              className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-medium"
              onClick={() =>
              void videoRef.current
                ?.play()
                .then(() => {
                  clockRef.current = { base: positionRef.current ?? Date.now(), started: Date.now() };
                  playingRef.current = true;
                  setPhase("playing");
                })
                .catch(() => setPhase("error"))
            }
            >
              Start video
            </button>
          ) : null}
          {visiblePhase === "paused" ? (
            <p className="absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-xs">Paused</p>
          ) : null}
        </div>
      </div>
      <p className="mt-2 font-mono text-base tabular-nums" aria-live="polite">
        {clock}
      </p>
      <div className="mt-2">
        <PlaybackControls
          playing={visiblePhase === "playing" || visiblePhase === "loading" || visiblePhase === "connecting"}
          muted={muted}
          volume={volume}
          disabled={controlsDisabled}
          onToggle={toggle}
          onBack={() => jump(-SEEK_MS)}
          onForward={() => jump(SEEK_MS)}
          onMute={() => setMuted((value) => !value)}
          onVolume={(next) => {
            setVolume(next);
            setMuted(next === 0);
          }}
          onFullscreen={fullscreen}
        />
      </div>
    </section>
  );
}
