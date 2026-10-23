"""Frame sampling from MediaMTX HLS substreams with a freshness-first policy.

Each enabled camera gets one reader thread that keeps only the newest frame. The
scheduler asks for a frame at the configured rate; if the reader has not produced
a newer frame, nothing is queued. The inference queue is bounded and drops its
oldest entry when full, so a slow CPU can never build a backlog of stale frames.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass, field
from urllib.parse import quote, urlsplit, urlunsplit

# MediaMTX's RTSP source is TCP-friendly and low latency; tell FFmpeg to use TCP
# before OpenCV loads its FFmpeg backend.
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

import cv2  # noqa: E402 - must come after the FFmpeg option is set
import numpy as np  # noqa: E402

log = logging.getLogger("object-worker.sampler")


def build_stream_url(kind: str, base: str, user: str, password: str, camera_id: int) -> str:
    """MediaMTX URL for a camera's H.264 substream.

    `rtsp` is the normal input: MediaMTX's HLS endpoint authenticates through a
    browser cookie handshake that FFmpeg/OpenCV cannot complete, while RTSP
    accepts the read credential directly. HLS stays available as a fallback.
    Credentials are never logged.
    """
    path = f"cam{camera_id}_sub"
    if kind == "hls":
        url = f"{base.rstrip('/')}/{path}/index.m3u8"
        if user:
            url += f"?user={quote(user, safe='')}&pass={quote(password, safe='')}"
        return url
    parts = urlsplit(base)
    if not parts.scheme or not parts.netloc:
        raise ValueError("invalid MediaMTX RTSP base URL")
    host = parts.hostname or ""
    port = parts.port
    auth = f"{quote(user, safe='')}:{quote(password, safe='')}@" if user else ""
    netloc = f"{auth}{host}" + (f":{port}" if port else "")
    return urlunsplit((parts.scheme, netloc, f"/{path}", "", ""))


@dataclass
class LatestFrame:
    frame: np.ndarray | None = None
    received_at: float = 0.0  # time.monotonic()
    sequence: int = 0


@dataclass
class CameraReader:
    camera_id: int
    url_provider: callable
    stale_after_s: float = 3.0
    reconnect_backoff_s: float = 2.0
    latest: LatestFrame = field(default_factory=LatestFrame)

    _stop: threading.Event = field(default_factory=threading.Event, repr=False)
    _thread: threading.Thread | None = field(default=None, repr=False)
    _lock: threading.Lock = field(default_factory=threading.Lock, repr=False)
    errors: int = 0
    last_error: str | None = None

    def start(self) -> None:
        if self._thread and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name=f"camera-{self.camera_id}", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2.0)
            self._thread = None

    def alive(self) -> bool:
        return bool(self._thread and self._thread.is_alive())

    def get(self) -> LatestFrame:
        with self._lock:
            return LatestFrame(
                frame=None if self.latest.frame is None else self.latest.frame.copy(),
                received_at=self.latest.received_at,
                sequence=self.latest.sequence,
            )

    def _run(self) -> None:
        while not self._stop.is_set():
            url = self.url_provider()
            if not url:
                self._stop.wait(self.reconnect_backoff_s)
                continue
            capture = cv2.VideoCapture(url, cv2.CAP_FFMPEG)
            if not capture.isOpened():
                self.errors += 1
                self.last_error = "open_failed"
                capture.release()
                log.warning("camera %s: could not open the MediaMTX stream; retrying", self.camera_id)
                self._stop.wait(self.reconnect_backoff_s)
                continue
            log.info("camera %s: stream connected", self.camera_id)
            try:
                while not self._stop.is_set():
                    ok, frame = capture.read()
                    if not ok or frame is None:
                        self.errors += 1
                        self.last_error = "read_failed"
                        log.warning("camera %s: stream read failed; reconnecting", self.camera_id)
                        break
                    with self._lock:
                        self.latest.frame = frame
                        self.latest.received_at = time.monotonic()
                        self.latest.sequence += 1
            finally:
                capture.release()
            if not self._stop.is_set():
                self._stop.wait(self.reconnect_backoff_s)
