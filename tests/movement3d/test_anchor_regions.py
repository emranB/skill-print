import copy

import numpy as np
import pytest

from test_alignment import canonical, pose
from local_alignment import HOLD_OBSERVATION_GAP_MS, LocalAlignment


def region_canonical(kind="cycle"):
    lesson = canonical(kind)
    ref = lesson["references"][0]
    ref["anchorConstruction"] = "observed-regions-v1"
    for i, sample in enumerate(ref["samples"]):
        sample["pose"]["timestampMs"] = i * 100
    for anchor in ref["anchors"]:
        anchor['holdSource']='teacher_requested'
        center = int(anchor["progress01"] * 100)
        indices = [center, center + 1] if center == 0 else [center - 1, center]
        anchor["region"] = dict(samples=[ref["samples"][i]["pose"] for i in indices],
                                startMs=indices[0] * 100, endMs=indices[-1] * 100,
                                startSourceIndex=indices[0], endSourceIndex=indices[-1], diameter=.03, maximumSpeed=.3)
    return lesson


@pytest.mark.parametrize("density", [.5, 1, 2])
@pytest.mark.parametrize("speed", [.5, 1, 2])
def test_observed_region_density_speed_and_observation_continuity(density, speed):
    n = int(31 * density)
    values = [0.] * int(9 * density) + np.linspace(0, 1, n).tolist() + [1.] * int(9 * density) + np.linspace(1, 0, n).tolist() + [0.] * int(9 * density)
    alignment = LocalAlignment(region_canonical(), 100)
    rows = [alignment.update(pose(value, i * 1000 / (15 * density) * speed)) for i, value in enumerate(values)]
    interval = 1000 / (15 * density) * speed
    expected = 0 if interval > HOLD_OBSERVATION_GAP_MS else 1
    assert sum(r["event"] == "REP_SUCCESS" for r in rows) == expected
    assert all(r["normalizedDtwDistance"] is None for r in rows)


def test_region_hold_is_not_a_preview_point_hold():
    alignment = LocalAlignment(region_canonical("sequence"))
    candidate = alignment.candidates[0]
    # The learned region contains a source observation .99; 1. is only the preview.
    candidate.phase = 0
    candidate.phase_position = .99
    candidate.last_timestamp = candidate.last_reliable_timestamp = candidate.last_supported_timestamp = 0
    from geometry import vector
    candidate.previous = vector(pose(1.245))
    candidate.origin = vector(pose(0))
    candidate.reach = 1.
    candidate.changes = 5
    # Beyond tolerance of the single endpoint, inside tolerance of another actual source.
    rows = [alignment.update(pose(.735, t)) for t in (67, 134, 201, 268)]
    assert sum(r["event"] == "SEQUENCE_COMPLETE" for r in rows) == 1


def test_short_confidence_gap_does_not_fabricate_hold_or_progress():
    alignment = LocalAlignment(region_canonical())
    alignment.update(pose(0, 0))
    invalid = pose(0, 67)
    invalid["bodySkeleton"]["orientationReliable"] = False
    assert alignment.update(invalid)["reason"] == "confidence_gap_no_progress"
    assert alignment.update(pose(0, 134))["lastSatisfiedAnchor"] is None
    assert alignment.update(pose(0, 201))["lastSatisfiedAnchor"] is None
    assert alignment.update(pose(0, 334))["lastSatisfiedAnchor"] == "start"
    before = alignment.candidates[0].progress
    invalid["timestampMs"] = 400
    alignment.update(invalid)
    row = alignment.update(pose(0, 467))
    assert row["currentProgressPercent"] / 100 == before
    assert row["event"] is None


def test_large_unobserved_hold_interval_and_long_loss_restart():
    alignment = LocalAlignment(region_canonical())
    alignment.update(pose(0, 0))
    assert alignment.update(pose(0, 400))["lastSatisfiedAnchor"] is None
    alignment.update(pose(0, 467))
    assert alignment.update(pose(0, 600))["lastSatisfiedAnchor"] == "start"
    invalid = pose(0, 1800)
    invalid["bodySkeleton"]["orientationReliable"] = False
    row = alignment.update(invalid)
    assert row["lastSatisfiedAnchor"] is None
    assert row["currentProgressPercent"] == 0


def test_regions_keep_anchor_barriers_and_sequence_no_wrap():
    alignment = LocalAlignment(region_canonical())
    values = [0.] * 9 + np.linspace(0, .6, 30).tolist() + [1.] + np.linspace(.6, 0, 30).tolist() + [0.] * 9
    rows = [alignment.update(pose(v,i*67)) for i,v in enumerate(values)]
    assert not any(r["event"] for r in rows)
    assert not any(r["lastSatisfiedAnchor"] == "completion" for r in rows)
    sequence = LocalAlignment(region_canonical("sequence"))
    values = [0.] * 9 + np.linspace(0, 1, 40).tolist() + [1.] * 9 + [0.,1.] * 20
    rows = [sequence.update(pose(v,i*67)) for i,v in enumerate(values)]
    assert sum(r["event"] == "SEQUENCE_COMPLETE" for r in rows) == 1
    assert not any(r["lastSatisfiedAnchor"] == "apex" for r in rows)


def test_region_reference_must_have_multiple_reliable_sources():
    lesson = copy.deepcopy(region_canonical())
    lesson["references"][0]["anchors"][0]["region"]["samples"] = [pose(0)]
    with pytest.raises(ValueError, match="multiple reliable"):
        LocalAlignment(lesson)


@pytest.mark.parametrize("regions", [False, True])
def test_invalid_pose_after_gap_does_not_compare_missing_geometry(regions):
    alignment = LocalAlignment(region_canonical() if regions else canonical())
    for t in (0,67,134,201):
        alignment.update(pose(0,t))
    invalid = pose(.5,1001)
    invalid["bodySkeleton"]["orientationReliable"] = False
    row = alignment.update(invalid)
    assert not row["usable"] and row["event"] is None
