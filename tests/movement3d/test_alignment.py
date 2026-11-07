import math
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "src/movement"))
from alignment import OnlineAlignment, constrained_dtw, arc_positions, dtw_ndim
from skeleton import body_skeleton


def pose(value, timestamp=0):
    angle = value * 1.2
    return dict(timestampMs=timestamp, bodySkeleton=dict(representation="rtmw3d-body-v1",
                bones=[[math.sin(angle), math.cos(angle), 0.] for _ in range(12)],
                boneConfidence=[1.] * 12, orientationReliable=True))


def canonical(kind="cycle"):
    samples = [dict(progress01=i / 100, phase="sequence" if kind == "sequence" else "outbound" if i < 50 else "apex" if i == 50 else "return",
                    pose=pose(i / 100 if kind == "sequence" else min(i, 100 - i) / 50)) for i in range(101)]
    anchors = [dict(**samples[i], id="start" if i == 0 else "completion" if i == 100 else "apex", holdMs=150)
               for i in ([0, 100] if kind == "sequence" else [0, 50, 100])]
    return dict(schemaVersion=3, representation="rtmw3d-body-v1", kind=kind,
                references=[dict(demonstrationId="teacher", teacherConfirmed=True, alignmentEligible=True, samples=samples, anchors=anchors)])


def replay(alignment, values):
    return [alignment.update(pose(value, i * 1000 / 15)) for i, value in enumerate(values)]


@pytest.mark.parametrize("difficulty", [1, 20, 50, 75, 80, 99, 100])
def test_coherent_cycle_at_15fps(difficulty):
    alignment = OnlineAlignment(canonical(), difficulty)
    values = [0.] * 5 + np.linspace(0, 1, 31).tolist() + [1.] * 5 + np.linspace(1, 0, 31).tolist() + [0.] * 5
    rows = replay(alignment, values)
    assert sum(r["event"] == "REP_SUCCESS" for r in rows) == 1


def test_standing_cannot_complete():
    rows = replay(OnlineAlignment(canonical()), [0.] * 200)
    assert not any(r["event"] for r in rows)
    assert max(r["currentProgressPercent"] for r in rows) < 50


def test_isolated_frames_and_reverse_sequence_do_not_complete():
    rows = replay(OnlineAlignment(canonical()), [0.] * 4 + [1., 0.] * 4)
    assert not any(r["event"] for r in rows)
    reverse = replay(OnlineAlignment(canonical("sequence")), [1.] * 5 + np.linspace(1, 0, 40).tolist() + [0.] * 5)
    assert not any(r["event"] for r in reverse)


def test_sequence_once_no_wrap_and_no_apex():
    alignment = OnlineAlignment(canonical("sequence"), 100)
    rows = replay(alignment, [0.] * 5 + np.linspace(0, 1, 50).tolist() + [1.] * 5 + [0., 1.] * 10)
    assert sum(r["event"] == "SEQUENCE_COMPLETE" for r in rows) == 1
    assert all(r["lastSatisfiedAnchor"] != "apex" for r in rows)


def test_low_confidence_and_gap_cannot_cross_anchor():
    alignment = OnlineAlignment(canonical())
    rows = replay(alignment, [0.] * 5 + np.linspace(0, .7, 15).tolist())
    invalid = pose(1., 2000)
    invalid["bodySkeleton"]["boneConfidence"] = [0.] * 12
    result = alignment.update(invalid)
    assert not result["usable"] and result["event"] is None
    assert result["lastSatisfiedAnchor"] != "apex"


def test_no_reference_switching_can_fabricate_completion():
    lesson = canonical()
    other = canonical()["references"][0]
    other["demonstrationId"] = "other"
    for sample in other["samples"]:
        sample["pose"]["bodySkeleton"]["bones"] = [[0., 0., 1.]] * 12
    lesson["references"].append(other)
    rows = replay(OnlineAlignment(lesson), [0.] * 5 + [1.] * 5 + [0.] * 5)
    assert not any(r["event"] for r in rows)


def test_dtaidistance_rejects_one_to_many_collapse():
    assert constrained_dtw(np.tile([0., 1., 0., 1.], (1,12)), np.tile([0., 1., 0., 1.], (100,12)), .3125) is None


def test_translation_scale_yaw_and_identity():
    points = np.zeros((17, 3))
    points[5:17] = [[-1,-2,0],[1,-2,0],[-2,-1,0],[2,-1,0],[-2,0,1],[2,0,1],[-1,0,0],[1,0,0],[-1,2,1],[1,2,1],[-1,4,0],[1,4,0]]
    confidence = np.ones(17)
    baseline = body_skeleton(points, confidence)
    rotation = np.array([[0.,0.,1.],[0.,1.,0.],[-1.,0.,0.]])
    changed = body_skeleton(points @ rotation.T * 3 + [20,10,8], confidence)
    assert np.allclose(baseline["bones"], changed["bones"])
    assert np.allclose(baseline["joints"], changed["joints"])


def test_legacy_rejected_not_relabeled():
    with pytest.raises(ValueError):
        OnlineAlignment(dict(schemaVersion=2))


@pytest.mark.parametrize("moving_frames", [21, 61])
def test_speed_changes_preserve_ordered_cycle(moving_frames):
    values = [0.] * 5 + np.linspace(0, 1, moving_frames).tolist() + [1.] * 5 + np.linspace(1, 0, moving_frames).tolist() + [0.] * 5
    rows = replay(OnlineAlignment(canonical(), 100), values)
    assert sum(r["event"] == "REP_SUCCESS" for r in rows) == 1


def test_return_cannot_cross_unsatisfied_apex_hold():
    # Exactly one frame is within apex tolerance, insufficient for its 150 ms hold.
    values = [0.] * 5 + np.linspace(0, .7, 22).tolist() + [1.] + np.linspace(.7, 0, 22).tolist() + [0.] * 5
    rows = replay(OnlineAlignment(canonical(), 100), values)
    assert not any(r["event"] for r in rows)
    assert all(r["lastSatisfiedAnchor"] not in ["apex", "completion"] for r in rows)


def test_missing_confirmation_is_not_implicitly_accepted():
    lesson = canonical()
    del lesson["references"][0]["teacherConfirmed"]
    with pytest.raises(ValueError, match="confirmed"):
        OnlineAlignment(lesson)


def test_cached_motion_statistics_equal_observed_history():
    alignment = OnlineAlignment(canonical(), 100)
    replay(alignment, [0.] * 5 + np.linspace(0, .7, 30).tolist())
    candidate = alignment.candidates[0]
    lengths, _ = arc_positions(candidate.observed)
    assert np.allclose(candidate.observed_lengths, lengths)


def test_impossible_slope_ratio_does_not_run_expensive_dtw(monkeypatch):
    def unexpected_solve(*args, **kwargs):
        pytest.fail("An impossible slope-constrained path should be rejected before solving")
    monkeypatch.setattr(dtw_ndim, "warping_path", unexpected_solve)
    assert constrained_dtw(np.ones((200, 48)), np.ones((5, 48)), .3125) is None


def test_completion_metadata_belongs_to_completed_reference(monkeypatch):
    lesson = canonical()
    lesson["references"].append({**lesson["references"][0], "demonstrationId": "other"})
    alignment = OnlineAlignment(lesson)
    completed, other = alignment.candidates
    completed.progress = other.progress = 1.
    completed.score, other.score = .8, 1.
    completed.dtw_distance, other.dtw_distance = .25, 0.
    monkeypatch.setattr(completed, "update", lambda *_: "REP_SUCCESS")
    result = alignment.update(pose(0, 0))
    assert result["event"] == "REP_SUCCESS"
    assert result["referenceId"] == "teacher"
    assert result["normalizedDtwDistance"] == .25
