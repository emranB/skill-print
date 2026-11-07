"""Local cursor timing; synthetic active stress is explicitly not accuracy evidence."""
import json
import argparse
from pathlib import Path
import sys

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "tests/movement3d"))
from test_alignment import canonical, pose
from local_alignment import LocalAlignment


rows = []
values = [0.] * 5 + np.linspace(0, 1, 31).tolist() + [1.] * 5 + np.linspace(1, 0, 31).tolist() + [0.] * 5
for count in (1, 6):
    for difficulty in (75, 100):
        lesson = canonical()
        lesson["references"] = [{**lesson["references"][0], "demonstrationId": f"synthetic-{i}"} for i in range(count)]
        timings, completions = [], []
        for repeat in range(10):
            alignment = LocalAlignment(lesson, difficulty)
            for index, value in enumerate(values):
                result = alignment.update(pose(value, index * 1000 / 15))
                timings.append(result["alignmentMs"])
            completions.append(alignment.reps)
        rows.append(dict(case="synthetic-active", retainedReferences=count, activeReferences=count, difficulty=difficulty,
                         frames=len(timings), meanMs=float(np.mean(timings)), p95Ms=float(np.percentile(timings, 95)),
                         maximumMs=max(timings), repetitionsPerReplay=completions))
compiled = json.loads(Path("test-results/movement/3d/compiled.json").read_text())
lesson = compiled["combined"]
timings = []
for reference in lesson["references"]:
    alignment = LocalAlignment(lesson, 100)
    for frame in reference["sourceTrajectory"]:
        timings.append(alignment.update(frame)["alignmentMs"])
rows.append(dict(case="unchanged-teacher-source-set", retainedReferences=len(lesson["references"]),
                 activeReferences=len(alignment.candidates), difficulty=100, frames=len(timings),
                 meanMs=float(np.mean(timings)), p95Ms=float(np.percentile(timings, 95)), maximumMs=max(timings)))
parser = argparse.ArgumentParser()
parser.add_argument("--output", default="test-results/movement/local-aligner/performance.json")
output = Path(parser.parse_args().output)
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(dict(note="Excludes RTMW3D inference, HTTP and rendering. No learner evaluation.", rows=rows), indent=2), encoding="utf-8")
print(output.read_text())
