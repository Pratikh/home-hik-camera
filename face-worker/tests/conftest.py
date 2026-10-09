"""Pytest fixtures shared by the worker tests."""

from __future__ import annotations

import sys
from pathlib import Path

WORKER_ROOT = Path(__file__).resolve().parent.parent

# Make the worker modules importable regardless of how pytest is invoked.
if str(WORKER_ROOT) not in sys.path:
    sys.path.insert(0, str(WORKER_ROOT))

# Make `helpers` importable from the test modules.
TESTS_DIR = Path(__file__).resolve().parent
if str(TESTS_DIR) not in sys.path:
    sys.path.insert(0, str(TESTS_DIR))

import pytest  # noqa: E402

from config import WorkerConfig, load_config  # noqa: E402
from helpers import HUB_DDL  # noqa: E402
from store import JobStore  # noqa: E402


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    (tmp_path / "events").mkdir(parents=True, exist_ok=True)
    (tmp_path / "face-crops").mkdir(parents=True, exist_ok=True)
    return tmp_path


@pytest.fixture
def store(data_dir: Path):
    job_store = JobStore(data_dir / "events.sqlite")
    job_store.connection.executescript(HUB_DDL)
    yield job_store
    job_store.close()


@pytest.fixture
def config(data_dir: Path) -> WorkerConfig:
    return load_config(
        {
            "DATA_DIR": str(data_dir),
            "FACE_DETECTION_ENABLED": "true",
            "FACE_DETECTION_CONFIDENCE": "0.60",
            "FACE_DETECTION_MAX_FACES": "10",
        }
    )
