"use client";

import { useEffect, useRef, useState } from "react";
import type { StreamResponse } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { FrameSkeleton, MessagePanel } from "@/components/ui/States";

type Phase = "loading" | "placeholder" | "blocked" | "connecting" | "reconnecting" | "live" | "hls" | "error" | "gesture";

function waitForIce(pc: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(resolve), 2500);
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish(resolve);
    };
    const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
    const finish = (done: () => void) => {
      clearTimeout(timer);
      pc.removeEventListener("icegatheringstatechange", onChange);
      signal.removeEventListener("abort", onAbort);
      done();
    };
    signal.addEventListener("abort", onAbort);
    pc.addEventListener("icegatheringstatechange", onChange);
  });
}

function waitUntilConnected(pc: RTCPeerConnection, signal: AbortSignal): Promise<void> {
  const connected = () =>
    pc.connectionState === "connected" || pc.iceConnectionState === "connected" || pc.iceConnectionState === "completed";
  if (connected()) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => finish(() => reject(new Error("webrtc_timeout"))), 20000);
    const check = () => {
      if (connected()) finish(resolve);
      if (pc.connectionState === "failed" || pc.iceConnectionState === "failed") {
        finish(() => reject(new Error("webrtc_failed")));
      }
    };
    const onAbort = () => finish(() => reject(new DOMException("Aborted", "AbortError")));
    const finish = (done: () => void) => {
      clearTimeout(timer);
      pc.removeEventListener("connectionstatechange", check);
      pc.removeEventListener("iceconnectionstatechange", check);
      signal.removeEventListener("abort", onAbort);
      done();
    };
    signal.addEventListener("abort", onAbort);
    pc.addEventListener("connectionstatechange", check);
    pc.addEventListener("iceconnectionstatechange", check);
  });
}

export async function startWhep(video: HTMLVideoElement, whepUrl: string, signal: AbortSignal) {
  const pc = new RTCPeerConnection({ iceServers: [] });
  const media = new MediaStream();
  pc.addTransceiver("video", { direction: "recvonly" });
  pc.addTransceiver("audio", { direction: "recvonly" });
  pc.ontrack = (event) => {
    media.addTrack(event.track);
    video.srcObject = media;
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitForIce(pc, signal);
  const response = await fetch(whepUrl, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/sdp" },
    body: pc.localDescription?.sdp ?? "",
    signal,
  });
  if (!response.ok) {
    pc.close();
    throw new Error("whep_failed");
  }
  const answer = await response.text();
  if (signal.aborted) {
    pc.close();
    throw new DOMException("Aborted", "AbortError");
  }
  await pc.setRemoteDescription({ type: "answer", sdp: answer });
  await waitUntilConnected(pc, signal);
  const location = response.headers.get("Location");
  return { pc, location };
}

export async function startHls(video: HTMLVideoElement, hlsUrl: string, signal: AbortSignal) {
  const playing = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("hls_timeout")), 20000);
    const onPlaying = () => {
      clearTimeout(timer);
      resolve();
    };
    const onError = () => {
      clearTimeout(timer);
      reject(new Error("hls_failed"));
    };
    video.addEventListener("playing", onPlaying, { once: true });
    video.addEventListener("error", onError, { once: true });
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
  void playing.catch(() => undefined);

  if (video.canPlayType("application/vnd.apple.mpegurl")) {
    video.src = hlsUrl;
    await video.play();
    await playing;
    return { destroy: () => undefined };
  }

  const imported = await import("hls.js");
  const Hls = imported.default;
  if (!Hls.isSupported()) throw new Error("hls_unsupported");
  const hls = new Hls({ lowLatencyMode: false, enableWorker: true });
  hls.on(Hls.Events.ERROR, (_event, data) => {
    if (data.fatal) video.dispatchEvent(new Event("error"));
  });
  hls.loadSource(hlsUrl);
  hls.attachMedia(video);
  await video.play();
  await playing;
  return { destroy: () => hls.destroy() };
}

export function LivePlayer({
  path,
  active,
  label,
}: {
  path: string;
  active: boolean;
  label: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [phase, setPhase] = useState<Phase>("loading");
  const [detail, setDetail] = useState<string>(Messages.connecting);
  const [muted, setMuted] = useState(true);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted]);

  useEffect(() => {
    if (!active) return;
    const video = videoRef.current;
    if (!video) return;
    const abort = new AbortController();
    const bag: { pc?: RTCPeerConnection; hls?: { destroy: () => void }; session?: string | null } = {};
    let stopped = false;

    const run = async (attempt: number) => {
      setPhase(attempt === 0 ? "loading" : "reconnecting");
      setDetail(attempt === 0 ? Messages.connecting : "Reconnecting");
      let session: StreamResponse;
      try {
        session = await api<StreamResponse>(`/api/streams/${path}`);
      } catch (error) {
        if (stopped || (error instanceof ApiError && error.status === 401)) return;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
          if (!stopped) await run(attempt + 1);
          return;
        }
        setDetail(error instanceof Error ? error.message : Messages.backendDown);
        setPhase("error");
        return;
      }
      if (stopped) return;
      if (session.mode === "placeholder") {
        setDetail(session.message ?? Messages.placeholder);
        setPhase("placeholder");
        return;
      }
      if (session.mode === "unavailable" || (!session.whepUrl && !session.hlsUrl)) {
        setDetail(session.message ?? Messages.streamUnavailable);
        setPhase("blocked");
        return;
      }

      const playHls = async (notice: string | null) => {
        if (!session.hlsUrl) throw new Error("hls_missing");
        setDetail(notice ?? Messages.liveHls);
        setPhase("connecting");
        bag.hls = await startHls(video, session.hlsUrl, abort.signal);
        if (stopped) return;
        setDetail(notice ?? Messages.liveHls);
        setPhase("hls");
      };

      try {
        setPhase("connecting");
        setDetail(session.mode === "hls" ? (session.message ?? Messages.liveHls) : Messages.connecting);
        if (session.mode === "hls") {
          await playHls(session.message);
        } else if (session.whepUrl) {
          try {
            const whep = await startWhep(video, session.whepUrl, abort.signal);
            bag.pc = whep.pc;
            bag.session = whep.location;
            if (stopped) return;
            try {
              await video.play();
            } catch {
              setPhase("gesture");
              setDetail(Messages.live);
              return;
            }
            setDetail(Messages.live);
            setPhase("live");
          } catch (error) {
            if (stopped || (error instanceof DOMException && error.name === "AbortError")) return;
            bag.pc?.close();
            bag.pc = undefined;
            await playHls(Messages.webrtcDown);
          }
        }
      } catch (error) {
        if (stopped || (error instanceof DOMException && error.name === "AbortError")) return;
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
          if (!stopped) await run(attempt + 1);
          return;
        }
        setDetail(Messages.streamUnavailable);
        setPhase("error");
      }
    };

    void run(0);
    const presence = window.setInterval(() => {
      void fetch("/api/streams/presence", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      }).catch(() => undefined);
    }, 20000);
    return () => {
      stopped = true;
      abort.abort();
      bag.pc?.close();
      bag.hls?.destroy();
      if (bag.session) {
        void fetch(bag.session, { method: "DELETE", credentials: "same-origin", keepalive: true });
      }
      video.srcObject = null;
      video.removeAttribute("src");
      window.clearInterval(presence);
    };
  }, [active, path, retryKey]);

  const showVideo = phase === "live" || phase === "hls" || phase === "gesture" || phase === "connecting";

  return (
    <div className="absolute inset-0 bg-black">
      <video
        ref={videoRef}
        className={`h-full w-full object-contain ${showVideo ? "block" : "hidden"}`}
        autoPlay
        playsInline
        muted={muted}
        aria-label={`Live view ${label}`}
      />
      {phase === "loading" || phase === "connecting" || phase === "reconnecting" ? (
        <div className="absolute inset-0">
          <FrameSkeleton />
        </div>
      ) : null}
      {phase === "placeholder" ? (
        <div className="flex h-full flex-col items-center justify-center gap-2 bg-[repeating-linear-gradient(135deg,#121820,#121820_12px,#1a2330_12px,#1a2330_24px)] px-4 text-center">
          <p className="text-sm font-semibold text-warn">{detail}</p>
        </div>
      ) : null}
      {phase === "blocked" || phase === "error" ? <MessagePanel message={detail} /> : null}
      {phase === "gesture" ? (
        <button
          type="button"
          className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm font-medium"
          onClick={() => void videoRef.current?.play().then(() => setPhase("live")).catch(() => setPhase("error"))}
        >
          Start video
        </button>
      ) : null}
      {phase === "live" || phase === "hls" ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-2">
          <span className="rounded-md bg-black/60 px-2 py-1 text-xs text-white">{detail}</span>
        </div>
      ) : null}
      {phase === "live" || phase === "hls" || phase === "gesture" ? (
        <button
          type="button"
          className="absolute bottom-2 left-2 inline-flex h-11 min-w-11 items-center justify-center rounded-lg border border-white/20 bg-black/60 px-3 text-xs font-medium text-white"
          onClick={() => setMuted((value) => !value)}
          aria-pressed={!muted}
          aria-label={muted ? `Unmute ${label}` : `Mute ${label}`}
        >
          {muted ? "Unmute" : "Mute"}
        </button>
      ) : null}
      {phase === "error" ? (
        <button
          type="button"
          className="absolute bottom-2 right-2 rounded-lg border border-white/20 bg-black/60 px-3 py-2 text-xs text-white"
          onClick={() => setRetryKey((value) => value + 1)}
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
