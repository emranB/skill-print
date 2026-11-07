"""Active DTW timing using synthetic ordered features, not model accuracy evidence."""
import json
from pathlib import Path
import sys
import time

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests/movement3d"))
from test_alignment import canonical, pose
from alignment import OnlineAlignment


rows = []
values = [0.] * 5 + np.linspace(0, 1, 31).tolist() + [1.] * 5 + np.linspace(1, 0, 31).tolist() + [0.] * 5
for count in [1, 6]:
    for difficulty in [75, 100]:
        lesson = canonical()
        lesson["references"] = [{**lesson["references"][0], "demonstrationId": f"synthetic-{i}"} for i in range(count)]
        alignment = OnlineAlignment(lesson, difficulty)
        timings, events = [], []
        for index, value in enumerate(values):
            started = time.perf_counter()
            result = alignment.update(pose(value, index * 1000 / 15))
            timings.append((time.perf_counter() - started) * 1000)
            if result["event"]:
                events.append(result["event"])
        rows.append(dict(references=count, difficulty=difficulty, frames=len(values),
                         meanMs=float(np.mean(timings)), p95Ms=float(np.percentile(timings, 95)),
                         maximumMs=max(timings), events=events))
output = Path("test-results/movement/3d/active-alignment-performance.json")
output.write_text(json.dumps(dict(note="Synthetic active alignment only; excludes inference, HTTP and rendering", rows=rows), indent=2))
print(output.read_text())
