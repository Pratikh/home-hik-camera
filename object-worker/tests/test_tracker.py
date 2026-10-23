from datetime import datetime, timedelta, timezone

from detector import Detection
from tracker import CameraTracker

START = datetime(2026, 10, 23, 9, 21, 0, tzinfo=timezone.utc)


def det(raw="person", conf=0.8, box=(100, 100, 50, 90)):
    classification = "person" if raw == "person" else "vehicle"
    x, y, w, h = box
    return Detection(raw_class=raw, classification=classification, confidence=conf, x=x, y=y, width=w, height=h)


def test_a_person_walking_past_is_one_event():
    tracker = CameraTracker(1)
    first = tracker.update([(det(), 0.7)], START, disappearance_timeout_s=3)
    assert [action.kind for action in first] == ["started"]
    track_id = first[0].track.id

    for offset in (1, 2, 3):
        actions = tracker.update([(det(box=(100 + offset, 100, 50, 90)), 0.7)], START + timedelta(seconds=offset), 3)
        assert [action.kind for action in actions] == ["updated"]
        assert actions[0].track.id == track_id
        assert actions[0].track.detection_count == offset + 1

    # No detection for longer than the timeout ends the same event.
    actions = tracker.update([], START + timedelta(seconds=8), disappearance_timeout_s=3)
    assert [action.kind for action in actions] == ["ended"]
    assert actions[0].track.id == track_id


def test_two_people_are_two_events():
    tracker = CameraTracker(1)
    actions = tracker.update([(det(box=(10, 10, 40, 80)), 0.7), (det(box=(300, 200, 40, 80)), 0.7)], START, 3)
    assert [action.kind for action in actions] == ["started", "started"]
    assert actions[0].track.id != actions[1].track.id


def test_person_and_vehicle_are_not_merged():
    tracker = CameraTracker(1)
    actions = tracker.update([(det("person", box=(100, 100, 40, 80)), 0.7), (det("car", box=(100, 100, 60, 40)), 0.7)], START, 3)
    assert len(actions) == 2
    assert {action.track.classification for action in actions} == {"person", "vehicle"}


def test_short_noise_is_dropped_when_never_persisted():
    tracker = CameraTracker(1)
    tracker.update([(det(), 0.7)], START, disappearance_timeout_s=1)
    # Never persisted: the ended action is reported, but the noise track is
    # removed from memory and the worker never writes an event for it.
    actions = tracker.update([], START + timedelta(seconds=5), disappearance_timeout_s=1)
    assert [action.kind for action in actions] == ["ended"]
    assert actions[0].track.persisted is False
    assert tracker.tracks == []


def test_track_count_is_bounded():
    tracker = CameraTracker(1, max_tracks=2)
    actions = tracker.update(
        [(det(box=(0, 0, 10, 20)), 0.7), (det(box=(50, 0, 10, 20)), 0.7), (det(box=(100, 0, 10, 20)), 0.7)],
        START,
        3,
    )
    assert len(actions) == 2
    assert len(tracker.tracks) == 2
