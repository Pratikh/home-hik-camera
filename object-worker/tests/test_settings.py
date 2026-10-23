import sqlite3
from datetime import datetime

from settings import CAMERA_IDS, default_config, load_config
from store import WorkerStore


def make_store(tmp_path):
    return WorkerStore(tmp_path / "events.sqlite")


def test_defaults_are_off_and_safe(tmp_path):
    store = make_store(tmp_path)
    config = load_config(store.connection)
    assert config.enabled is False
    assert config.enabled_cameras() == []
    assert config.person_confidence == 0.7
    assert config.vehicle_confidence == 0.7
    assert config.base_fps == 1.0
    assert config.active_fps == 3.0
    assert config.max_fps == 5.0
    assert config.max_concurrent == 1
    assert config.queue_size == 2
    assert config.disappearance_timeout_s == 3.0
    assert config.detection_source == "ai_only"
    assert len(config.cameras) == len(CAMERA_IDS)
    store.close()


def test_camera_overrides_and_master_switch(tmp_path):
    store = make_store(tmp_path)
    store.connection.execute(
        "UPDATE object_detection_settings SET enabled=1, person_confidence=0.7, vehicle_confidence=0.7 WHERE id=1"
    )
    store.connection.execute(
        "UPDATE object_detection_camera_settings SET enabled=1, person_enabled=1, person_confidence=0.85, vehicle_enabled=0 WHERE camera_id=2"
    )
    config = load_config(store.connection)
    assert config.enabled is True
    assert 2 in config.enabled_cameras()
    assert 1 not in config.enabled_cameras()
    effective = config.effective(2)
    assert effective.enabled is True
    assert effective.person is True
    assert effective.person_confidence == 0.85
    assert effective.vehicle is False
    assert effective.vehicle_confidence == 0.7
    store.close()


def test_out_of_range_values_are_clamped(tmp_path):
    store = make_store(tmp_path)
    store.connection.execute(
        """UPDATE object_detection_settings SET
             enabled=1, person_confidence=1.5, vehicle_confidence=0.2,
             base_fps=50, active_fps=0.1, max_fps=-3, max_concurrent=99, queue_size=200,
             disappearance_timeout_s=99, activity_timeout_s=0, detection_source='nope'
           WHERE id=1"""
    )
    config = load_config(store.connection)
    assert config.person_confidence == 0.7  # fallback, not 1.5
    assert config.vehicle_confidence == 0.7
    assert config.base_fps == 1.0
    assert config.active_fps >= config.base_fps
    assert config.max_fps >= config.active_fps
    assert config.max_concurrent == 1
    assert config.queue_size == 2
    assert config.disappearance_timeout_s == 3.0
    assert config.activity_timeout_s == 10.0
    assert config.detection_source == "ai_only"
    store.close()


def test_master_off_forces_every_camera_off(tmp_path):
    store = make_store(tmp_path)
    store.connection.execute("UPDATE object_detection_settings SET enabled=0 WHERE id=1")
    store.connection.execute("UPDATE object_detection_camera_settings SET enabled=1")
    config = load_config(store.connection)
    assert config.enabled is False
    assert config.enabled_cameras() == []
    store.close()
