"""The compose healthcheck must treat "detection disabled" as healthy."""

from __future__ import annotations

import importlib.util
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "healthcheck.py"


def load_healthcheck():
    spec = importlib.util.spec_from_file_location("object_worker_healthcheck", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


@pytest.fixture()
def health_db(tmp_path, monkeypatch):
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    monkeypatch.setenv("DATA_DIR", str(data_dir))
    connection = sqlite3.connect(data_dir / "events.sqlite")
    connection.execute(
        "CREATE TABLE object_worker_heartbeat (id INTEGER PRIMARY KEY, status TEXT NOT NULL, updated_at TEXT NOT NULL, metrics TEXT)"
    )
    connection.commit()

    def set_heartbeat(status: str, updated_at: datetime) -> None:
        connection.execute(
            "INSERT OR REPLACE INTO object_worker_heartbeat (id, status, updated_at, metrics) VALUES (1, ?, ?, NULL)",
            (status, updated_at.isoformat().replace("+00:00", "Z")),
        )
        connection.commit()

    yield set_heartbeat
    connection.close()


def test_fresh_heartbeat_is_healthy_for_running_and_disabled(health_db):
    healthcheck = load_healthcheck()
    now = datetime.now(timezone.utc)
    health_db("disabled", now)
    assert healthcheck.heartbeat_age_seconds(now) == (0.0, "disabled")
    health_db("running", now)
    assert healthcheck.heartbeat_age_seconds(now) == (0.0, "running")


def test_stale_heartbeat_is_unhealthy(health_db):
    healthcheck = load_healthcheck()
    now = datetime.now(timezone.utc)
    health_db("running", now - timedelta(seconds=healthcheck.MAX_AGE_SECONDS + 1))
    age, status = healthcheck.heartbeat_age_seconds(now)
    assert status == "running"
    assert age > healthcheck.MAX_AGE_SECONDS


def test_missing_database_or_heartbeat_is_unhealthy(tmp_path, monkeypatch):
    healthcheck = load_healthcheck()
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "missing"))
    assert healthcheck.heartbeat_age_seconds() == (None, None)


def test_explicit_error_status_is_unhealthy(health_db):
    healthcheck = load_healthcheck()
    now = datetime.now(timezone.utc)
    health_db("error", now)
    age, status = healthcheck.heartbeat_age_seconds(now)
    assert age == 0.0 and status == "error"
