"""Empirical annotations live here only, never in the production matcher."""
import json
from pathlib import Path
import time
import argparse

import numpy as np
from alignment import OnlineAlignment, vector, constrained_dtw, resample, distance

root = Path("test-results/movement/3d")
compiled = json.loads((root / "compiled.json").read_text())
parser = argparse.ArgumentParser()
parser.add_argument("--references", choices=["automatic", "annotated"], default="automatic")
args = parser.parse_args()
canonical = compiled["automatic"]["compilation"].get("canonical") if args.references == "automatic" else compiled["combined"]
output = root / args.references
output.mkdir(exist_ok=True)
teacher = json.loads((root / "roi/lesson-squat-rtmw3d.json").read_text())
learner = json.loads((root / "roi/test-squat-student_1-rtmw3d.json").read_text())
attempts = [("front-1",9000,14000),("front-2",14000,18000),("side-1",23000,28000),("side-2",28000,33000)]
negatives = [("setup-walking",0,9000),("turn-standing",18000,23000),("exit",33000,40000)]


def replay(frames, difficulty):
    alignment = OnlineAlignment(canonical, difficulty)
    rows = []
    for frame in frames:
        rows.append(dict(timestampMs=frame["timestampMs"], **alignment.update(frame)))
    return dict(reps=alignment.reps, maximumProgress=alignment.maximum * 100, trace=rows)


def region(rows, name, start, end):
    selected = [r for r in rows if start <= r["timestampMs"] < end]
    distances = [r["normalizedDtwDistance"] for r in selected if r["normalizedDtwDistance"] is not None]
    return dict(name=name, frames=len(selected), usable=sum(r["usable"] for r in selected),
                maximumProgress=max((r["currentProgressPercent"] for r in selected),default=0),
                maximumSimilarity=max((r["similarity"] for r in selected),default=0),
                minimumNormalizedDtwDistance=min(distances,default=None),
                closestReference=max(selected,key=lambda r:r["similarity"])["referenceId"] if selected else None,
                successEvents=sum(r["event"] == "REP_SUCCESS" for r in selected))


matrix = []
for difficulty in [20,50,75,80,100]:
    started = time.perf_counter()
    result = replay(learner["frames"], difficulty)
    (output / f"dtw-{difficulty}-raw.json").write_text(json.dumps(result))
    row = dict(difficulty=difficulty, reps=result["reps"], maximumProgress=result["maximumProgress"],
               attempts=[region(result["trace"],*item) for item in attempts],
               independentAttempts=[dict(**region((independent := replay([f for f in learner["frames"] if item[1] <= f["timestampMs"] < item[2]],difficulty))["trace"],*item),reps=independent["reps"]) for item in attempts],
               negatives=[region(result["trace"],*item) for item in negatives],
               alignmentMeanMs=float(np.mean([r["alignmentMs"] for r in result["trace"]])),
               alignmentP95Ms=float(np.percentile([r["alignmentMs"] for r in result["trace"]],95)),
               elapsedSeconds=time.perf_counter()-started)
    matrix.append(row)
    (output / "difficulty-matrix.json").write_text(json.dumps(matrix,indent=2))
    print(json.dumps(row),flush=True)

teacher_windows = [(8067,10533),(13000,16467),(18267,21067),(30733,39133),(42333,46600),(56867,63333)]
teacher_rows = []
for i,(start,end) in enumerate(teacher_windows):
    frames = [f for f in teacher["frames"] if start <= f["timestampMs"] <= end]
    result = replay(frames,75)
    teacher_rows.append(dict(**region(result["trace"],f"teacher-{i+1}",start,end+1),
                             reps=result["reps"],visualRegime="front" if i<3 else "side"))
    (output / f"teacher-{i+1}-raw.json").write_text(json.dumps(result))
(output / "teacher-consistency.json").write_text(json.dumps(teacher_rows,indent=2))
negative_rows = []
for item in negatives:
    name,start,end = item
    frames = [f for f in learner["frames"] if start <= f["timestampMs"] < end]
    result = replay(frames,75)
    negative_rows.append(dict(**region(result["trace"],*item),reps=result["reps"]))
(output / "negative-replays.json").write_text(json.dumps(negative_rows,indent=2))
print("teacher",json.dumps(teacher_rows),flush=True)
print("negative",json.dumps(negative_rows),flush=True)
