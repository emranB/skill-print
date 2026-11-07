import base64

import cv2
import numpy as np

from test_alignment import canonical, pose
from local_alignment import LocalAlignment
import worker


def test_bound_inference_uses_same_core_once_and_finish_unbinds(monkeypatch):
    class FakeModel:
        def infer(self, image, timestamp, stream):
            return pose(0, timestamp)
    monkeypatch.setattr(worker, "model", FakeModel())
    monkeypatch.setattr(worker, "runs", {})
    monkeypatch.setattr(worker, "bindings", {})
    image = base64.b64encode(cv2.imencode(".png", np.zeros((8,8,3), np.uint8))[1]).decode()
    request = dict(operation="infer", streamId="stream", image=image, timestampMs=0)
    assert "alignment" not in worker.dispatch(request)
    lesson = canonical()
    direct = LocalAlignment(lesson)
    worker.dispatch(dict(operation="start", runId="run", streamId="stream", canonical=lesson, difficulty=75, leniency=.25))
    for timestamp in [0, 100, 200]:
        result = worker.dispatch(dict(request, timestampMs=timestamp))
        expected = direct.update(pose(0, timestamp))
        assert result["alignment"]["runId"] == "run"
        assert result["alignment"]["timestampMs"] == timestamp
        for field in ["event", "currentProgressPercent", "lastSatisfiedAnchor", "reason"]:
            assert result["alignment"]["result"][field] == expected[field]
    worker.dispatch(dict(operation="bind", runId="run", streamId="replacement"))
    assert "alignment" not in worker.dispatch(dict(request, timestampMs=300))
    assert "alignment" in worker.dispatch(dict(request, streamId="replacement", timestampMs=300))
    worker.dispatch(dict(operation="finish", runId="run"))
    assert not worker.runs and not worker.bindings
    assert "alignment" not in worker.dispatch(dict(request, streamId="replacement", timestampMs=400))
