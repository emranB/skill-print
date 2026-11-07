import copy

import numpy as np
import pytest

from test_alignment import canonical, pose, replay
from local_alignment import FORWARD_REACH, LocalAlignment


@pytest.mark.parametrize("difficulty", [1, 20, 50, 75, 80, 99, 100])
@pytest.mark.parametrize("density", [.5, 1, 2])
def test_local_cycle_speed_and_density(difficulty, density):
    n = int(31 * density)
    alignment = LocalAlignment(canonical(), difficulty)
    values = [0.] * 5 + np.linspace(0, 1, n).tolist() + [1.] * 5 + np.linspace(1, 0, n).tolist() + [0.] * 5
    rows = replay(alignment, values)
    assert sum(r["event"] == "REP_SUCCESS" for r in rows) == 1
    assert all(r["normalizedDtwDistance"] is None for r in rows)


def test_local_standing_isolated_frames_and_reverse_do_not_complete():
    for values in ([0.] * 200, [0.] * 5 + [1., 0.] * 20):
        rows = replay(LocalAlignment(canonical(), 100), values)
        assert not any(r["event"] for r in rows)
    rows = replay(LocalAlignment(canonical("sequence"), 100), [1.] * 5 + np.linspace(1, 0, 40).tolist() + [0.] * 5)
    assert not any(r["event"] for r in rows)


def test_generated_anchor_values_do_not_impose_a_hold():
    lesson=canonical()
    assert all(a['holdMs']==150 for a in lesson['references'][0]['anchors'])
    alignment=LocalAlignment(lesson)
    assert alignment.update(pose(0,0))['lastSatisfiedAnchor']=='start'
    values=np.linspace(0,1,31).tolist()+np.linspace(1,0,31).tolist()
    rows=[alignment.update(pose(v,(i+1)*1000/15)) for i,v in enumerate(values)]
    assert sum(r['event']=='REP_SUCCESS' for r in rows)==1


def test_only_explicitly_requested_holds_require_elapsed_support():
    lesson=canonical()
    for anchor in lesson['references'][0]['anchors']:
        anchor['holdSource']='teacher_requested'
    alignment=LocalAlignment(lesson)
    assert alignment.update(pose(0,0))['lastSatisfiedAnchor'] is None
    assert alignment.update(pose(0,67))['lastSatisfiedAnchor'] is None
    assert alignment.update(pose(0,134))['lastSatisfiedAnchor'] is None
    assert alignment.update(pose(0,201))['lastSatisfiedAnchor']=='start'


def test_local_sequence_no_wrap_and_no_apex():
    rows = replay(LocalAlignment(canonical("sequence"), 100), [0.] * 5 + np.linspace(0, 1, 31).tolist() + [1.] * 5 + [0., 1.] * 10)
    assert sum(r["event"] == "SEQUENCE_COMPLETE" for r in rows) == 1
    assert all(r["lastSatisfiedAnchor"] != "apex" for r in rows)


def test_local_unsatisfied_apex_is_a_barrier():
    values = [0.] * 5 + np.linspace(0, .7, 22).tolist() + [1.] + np.linspace(.7, 0, 22).tolist() + [0.] * 5
    rows = replay(LocalAlignment(canonical(), 100), values)
    assert not any(r["event"] for r in rows)
    assert all(r["lastSatisfiedAnchor"] not in ["apex", "completion"] for r in rows)


def test_local_endpoint_hold_counts_supported_geometry_before_exact_endpoint():
    # Completion support starts inside tolerance, before the exact final pose.
    values = [0.] * 5 + np.linspace(0, .8, 31).tolist() + [.85, .9, .95, 1.]
    rows = replay(LocalAlignment(canonical("sequence"), 100), values)
    assert sum(r["event"] == "SEQUENCE_COMPLETE" for r in rows) == 1


@pytest.mark.parametrize("difficulty", [20, 75, 100])
def test_local_small_frame_drops_preserve_observation_timestamps(difficulty):
    values = [0.] * 5 + np.linspace(0, 1, 31).tolist() + [1.] * 5 + np.linspace(1, 0, 31).tolist() + [0.] * 5
    alignment = LocalAlignment(canonical(), difficulty)
    rows = [alignment.update(pose(value, i * 1000 / 15)) for i, value in enumerate(values) if i % 7 != 3]
    assert sum(r["event"] == "REP_SUCCESS" for r in rows) == 1


def test_local_tracking_loss_restarts_instead_of_bridging():
    alignment = LocalAlignment(canonical())
    replay(alignment, [0.] * 5 + np.linspace(0, .7, 22).tolist())
    result = alignment.update(pose(1, 5000))
    assert result["event"] is None
    assert result["lastSatisfiedAnchor"] is None
    assert result["currentProgressPercent"] == 0
    invalid = pose(1, 5067)
    invalid["bodySkeleton"]["orientationReliable"] = False
    assert not alignment.update(invalid)["usable"]


def test_local_nonfinite_common_bone_distance_cannot_count_as_motion():
    alignment = LocalAlignment(canonical())
    for i in range(5):
        frame = pose(0, i * 1000 / 15)
        frame["bodySkeleton"]["boneConfidence"] = [1.] * 6 + [0.] * 6
        alignment.update(frame)
    frame = pose(.1, 400)
    frame["bodySkeleton"]["boneConfidence"] = [0.] * 6 + [1.] * 6
    result = alignment.update(frame)
    assert result["usable"] and result["reason"] == "tracking_common_bones_restart"
    assert result["lastSatisfiedAnchor"] is None and result["event"] is None
    assert alignment.candidates[0].reach == 0


def test_local_multiple_targets_one_observation_without_global_jump():
    alignment = LocalAlignment(canonical(), 100)
    replay(alignment, [0.] * 5)
    previous = alignment.candidates[0].phase_position
    row = alignment.update(pose(.2, 500))
    assert row["runtimeTargetIndex"] > 1
    assert 0 < alignment.candidates[0].phase_position - previous <= FORWARD_REACH
    row = alignment.update(pose(1, 567))
    assert row["lastSatisfiedAnchor"] == "start"
    assert alignment.candidates[0].phase_position <= .2 + FORWARD_REACH


def test_local_candidate_progress_monotonic_without_history_or_dtw(monkeypatch):
    import dtaidistance.dtw_ndim
    monkeypatch.setattr(dtaidistance.dtw_ndim, "warping_path", lambda *a, **k: pytest.fail("No live DTW"))
    alignment = LocalAlignment(canonical(), 100)
    rows = replay(alignment, [0.] * 5 + np.linspace(0, .7, 40).tolist())
    assert np.all(np.diff([r["currentProgressPercent"] for r in rows]) >= 0)
    assert not hasattr(alignment.candidates[0], "observed")


def test_local_references_never_combine_phases():
    lesson = canonical()
    other = copy.deepcopy(lesson["references"][0])
    other["demonstrationId"] = "other"
    for sample in other["samples"]:
        sample["pose"]["bodySkeleton"]["bones"] = [[0., 0., 1.]] * 12
    lesson["references"].append(other)
    rows = replay(LocalAlignment(lesson), [0.] * 5 + [1.] * 5 + [0.] * 5)
    assert not any(r["event"] for r in rows)


def test_local_completion_metadata_and_confirmation(monkeypatch):
    lesson = canonical()
    other = copy.deepcopy(lesson["references"][0])
    other["demonstrationId"] = "other"
    lesson["references"].append(other)
    alignment = LocalAlignment(lesson)
    completed, other = alignment.candidates
    completed.progress = other.progress = 1.
    completed.score, other.score = .8, 1.
    completed.local_distance = .25
    monkeypatch.setattr(completed, "update", lambda *_: "REP_SUCCESS")
    result = alignment.update(pose(0, 0))
    assert result["referenceId"] == "teacher" and result["localDistance"] == .25
    del lesson["references"][0]["teacherConfirmed"]
    lesson["references"][1]["alignmentEligible"] = False
    with pytest.raises(ValueError, match="confirmed"):
        LocalAlignment(lesson)
