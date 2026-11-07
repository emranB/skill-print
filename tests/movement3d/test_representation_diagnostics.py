import copy

import numpy as np
import pytest

from test_alignment import pose  # Initializes the shared movement module path.
from motion_features import features
from representation_collision import arm_cycle
from trajectory_experiment import Cursor,metric


def test_reduced_descriptor_has_a_directional_collision_not_a_generic_success():
    forward,backward=arm_cycle(1),arm_cycle(-1)
    weights=np.ones(12)
    for a,b in zip(forward,backward):
        assert metric(features(a,'mediapipe-invariant'),features(b,'mediapipe-invariant'),weights)==0
    assert metric(features(forward[30],'mediapipe-body'),features(backward[30],'mediapipe-body'),weights)>.5
    assert metric(features(forward[30],'mediapipe-gram'),features(backward[30],'mediapipe-gram'),weights)>0


def test_all_twelve_bones_and_confidences_survive_each_complete_descriptor():
    frame=arm_cycle(1)[15]
    for strategy in ('mediapipe-invariant','mediapipe-body','mediapipe-gram','mediapipe-kinematic-body'):
        values,confidence=features(frame,strategy)
        assert values.shape[0]==12 and confidence.shape[0]==12
        assert np.isfinite(values).all() and np.all(confidence>0)
    assert features(dict(landmarks=[],worldLandmarks=[]),'mediapipe-invariant') is None
    assert features(pose(0),'rtmw-3d') is not None


@pytest.mark.parametrize('difficulty',[20,50,75,80,100])
def test_causal_diagnostic_has_no_history_dtw_or_universal_dwell(difficulty):
    frames=arm_cycle(1)
    rows=[(f,features(f,'mediapipe-invariant')) for f in frames]
    weights=np.ones(12)
    steps=[metric(a[1],b[1],weights) for a,b in zip(rows,rows[1:])]
    cal=dict(weights=weights.tolist(),noise=float(np.median(steps)),tolerance=float(np.percentile(steps,95)))
    cursor=Cursor(rows,cal,difficulty)
    for row in rows:cursor.update(row)
    assert cursor.complete
    assert not hasattr(cursor,'observed')
    static=Cursor(rows,cal,difficulty)
    for i in range(150):
        frame=copy.deepcopy(frames[0]);frame['timestampMs']=i*67
        static.update((frame,rows[0][1]))
    assert not static.complete
