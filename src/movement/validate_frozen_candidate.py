"""Teacher-only robustness of an already frozen diagnostic, without recalibration."""
import argparse
import json
from pathlib import Path

import numpy as np

from compare_teacher_representations import trajectory
from trajectory_experiment import replay


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--frozen", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    frozen = json.loads(Path(args.frozen).read_text())
    data = json.loads(Path(frozen["input"]).read_text())
    rows = trajectory(data.get("frames") or data["analysis"]["poseRecording"]["frames"], frozen["strategy"])
    refs = [[row for row in rows if window["startMs"] <= row[0]["timestampMs"] <= window["endMs"]]
            for window in frozen["segmentation"]["windows"]]
    if "eligible" in frozen:
        refs = [refs[i] for i in frozen["eligible"]]
    calibration = frozen["calibration"]
    report = dict(teacherOnly=True, frozen=args.frozen, recalibrated=False, selfReplay={}, resampling={}, static=[])
    for difficulty in (20, 50, 75, 80, 100):
        report["selfReplay"][difficulty] = [replay(ref, ref, calibration, difficulty) for ref in refs]
    for density in (.5, 1, 2):
        executions = []
        for ref in refs:
            if density == .5:
                execution = ref[::2]
            elif density == 1:
                execution = ref
            else:
                execution = []
                for a, b in zip(ref, ref[1:]):
                    execution.extend([a, ({"timestampMs": (a[0]["timestampMs"] + b[0]["timestampMs"]) / 2},
                                          ((a[1][0] + b[1][0]) / 2, np.minimum(a[1][1], b[1][1])))])
                execution.append(ref[-1])
            executions.append(replay(execution, ref, calibration, 75))
        report["resampling"][str(density)] = executions
    report["resampling"]["drops"] = [replay([row for i, row in enumerate(ref) if i % 7 != 3], ref, calibration, 75) for ref in refs]
    report["static"] = [replay([({"timestampMs": i * 67}, ref[0][1]) for i in range(150)], ref, calibration, 100) for ref in refs]
    Path(args.output).write_text(json.dumps(report, indent=2))
    print(json.dumps(dict(selfReplay={key: sum(row["complete"] for row in rows) for key, rows in report["selfReplay"].items()},
                          resampling={key: sum(row["complete"] for row in rows) for key, rows in report["resampling"].items()},
                          static=sum(row["complete"] for row in report["static"]))))


if __name__ == "__main__":
    main()
