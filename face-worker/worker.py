"""Local face-detection worker.

Run it beside the hub as a separate process or as the `face-worker` Podman
service. It reads the queue from the hub's SQLite database and writes detected
faces and crops back. It never touches the live streams, the DVR, the rule
engine or notification history.

    FACE_DETECTION_ENABLED=true python3 face-worker/worker.py
    python3 face-worker/worker.py --once     # one batch, then exit

With FACE_DETECTION_ENABLED unset or false the worker logs that detection is off
and exits without loading a model or writing anything.
"""

from __future__ import annotations

import argparse
import logging
import signal
import sys
import threading
from datetime import datetime, timedelta, timezone

from config import WorkerConfig, load_config
from detector import DetectorError, build_detector
from pipeline import ProcessOutcome, process_event
from store import JobStore
from timeutil import kolkata_iso

log = logging.getLogger("face-worker")

EXIT_OK = 0
EXIT_CONFIG = 2
EXIT_DATABASE = 3


def run_once(store: JobStore, detector, config: WorkerConfig) -> list[ProcessOutcome]:
    """Queue recent snapshots, reclaim stalled jobs, process one batch."""
    now = datetime.now(timezone.utc)
    since = kolkata_iso(now - timedelta(days=config.backfill_days))
    stale = kolkata_iso(now - timedelta(seconds=config.stale_after_s))

    queued = store.enqueue(since, config.batch_size * 20)
    reclaimed = store.reclaim_stale(stale)
    if queued or reclaimed:
        log.info("queued %d event(s), reclaimed %d stalled job(s)", queued, reclaimed)

    outcomes: list[ProcessOutcome] = []
    for event_id in store.claim(config.batch_size):
        outcomes.append(process_event(store, detector, config, event_id))
    for outcome in outcomes:
        if outcome.faces:
            log.info("event %s: stored %d face(s)", outcome.event_id, outcome.faces)
    return outcomes


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Home CCTV Hub local face-detection worker (detection only)")
    parser.add_argument("--once", action="store_true", help="process one batch and exit")
    parser.add_argument("--verbose", action="store_true", help="debug logging")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="[face-worker] %(levelname)s %(message)s",
    )

    config = load_config()
    if not config.enabled:
        log.info("FACE_DETECTION_ENABLED is not true; no detector is started and no work is done")
        return EXIT_OK

    if not config.db_path.is_file():
        log.error("database not found at %s", config.db_path)
        log.error("start the hub once so it creates data/events.sqlite, or check DATA_DIR")
        return EXIT_DATABASE

    try:
        detector = build_detector(config)
    except DetectorError as error:
        log.error("%s", error)
        log.error("fetch the model once, then restart: python3 face-worker/scripts/download_model.py")
        return EXIT_CONFIG
    assert detector is not None  # build_detector only returns None when disabled

    log.info(
        "starting: detector=%s model=%s confidence>=%.2f max_faces=%d data=%s",
        detector.name,
        detector.model,
        config.confidence,
        config.max_faces,
        config.data_dir,
    )

    store = JobStore(config.db_path)
    stopping = threading.Event()

    def request_stop(signum, _frame):  # pragma: no cover - signal path
        log.info("received signal %s, finishing the current batch", signum)
        stopping.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    try:
        if args.once:
            run_once(store, detector, config)
            return EXIT_OK
        while not stopping.is_set():
            try:
                run_once(store, detector, config)
            except Exception:  # a bad batch must not kill the worker
                log.exception("worker cycle failed")
            stopping.wait(config.poll_interval_s)
    finally:
        store.close()
    return EXIT_OK


if __name__ == "__main__":  # pragma: no cover
    sys.exit(main())
