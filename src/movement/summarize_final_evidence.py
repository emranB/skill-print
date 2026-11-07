"""Summarize preserved experiments without fitting, selecting or accepting a model."""
import hashlib
import json
from pathlib import Path

import numpy as np

ROOT = Path("test-results/movement/final-generic")


def read(name):
    return json.loads((ROOT / name).read_text())


def count_complete(rows):
    return sum(bool(row and row.get("complete")) for row in rows)


def matrix_results(report):
    return [row["results"] if isinstance(row, dict) else row for row in report["matrix"]]


def experiment(name):
    report = read(name)
    matrix = matrix_results(report)
    # Diagonal identity cells are explicitly excluded from held-out success counts.
    heldout = [any(cell and cell.get("complete") for j, cell in enumerate(row) if i != j)
               for i, row in enumerate(matrix)]
    return {
        "artifact": name,
        "eligible": report.get("eligible", list(range(len(matrix)))),
        "selfReplay": {key: count_complete(rows) for key, rows in report["selfReplay"].items()},
        "heldoutAnyCompletion": heldout,
        "heldoutExecutionsCompleted": sum(heldout),
        "halfDensity": count_complete(report.get("halfDensity", report.get("resampling", {}).get("0.5", []))),
        "completionMatrix": [[None if i == j else bool(cell and cell.get("complete"))
                              for j, cell in enumerate(row)] for i, row in enumerate(matrix)],
        "maximumProgressPercentMatrix": [[None if i == j else 100 * cell.get("progress", 0)
                                          for j, cell in enumerate(row)] for i, row in enumerate(matrix)],
    }


def main():
    learner = read("invariant-landmarks-learner.json")
    production = read("production-no-hold/summary.json")
    models = []
    for name in ("teacher-heavy-GPU-IMAGE-seekable.json", "teacher-heavy-GPU-VIDEO-seekable.json",
                 "teacher-full-CPU-VIDEO-seekable.json"):
        report = read(name)
        timestamps = [frame["timestampMs"] for frame in report["frames"]]
        if timestamps[-1] < 65000 or any(b <= a for a, b in zip(timestamps, timestamps[1:])):
            raise ValueError(f"Invalid seek probe: {name}")
        models.append({"artifact": name, "model": report["model"], "delegate": report["delegate"],
                       "mode": report["mode"], "frames": len(timestamps),
                       "meanInferenceMs": float(np.mean(report["inferenceMs"])),
                       "p95InferenceMs": float(np.percentile(report["inferenceMs"], 95)),
                       "elapsedMs": report["elapsedMs"]})
    report = {
        "conclusion": "NOT READY",
        "productionChange": "Remove generated mandatory holds; explicitly teacher-requested holds remain supported.",
        "noReplacementPromoted": True,
        "representations": read("teacher-representations.json"),
        "segmentation": read("segmentation-v4-fixed-lag.json"),
        "experiments": [experiment(name) for name in (
            "fitted-full-invariant-landmarks.json", "fitted-full-invariant-balanced.json",
            "fitted-full-kinematic-balanced.json", "fitted-full-gram-balanced.json",
            "fitted-full-kinematic-predictable-channels.json", "covariance-teacher.json",
            "fitted-heavy-video-body-balanced.json")],
        "heavyOriginalFrozenRobustness": read("heavy-body-original-frozen-robustness.json"),
        "learnerDiagnosticOnly": {
            "teacherCalibrationSha256": learner["teacherCalibrationSha256"],
            "attempts": {key: {name: {"repetitions": len(row["events"]),
                                      "maximumProgressPercent": 100 * row["maximumProgress"]}
                               for name, row in rows.items()}
                         for key, rows in learner["learnerAttempts"].items()},
            "continuous": {key: {"repetitions": len(row["events"]), "events": row["events"],
                                 "matchingMs": row["matchingMs"]}
                           for key, row in learner["continuous"].items()},
            "negatives": {key: {name: len(row["events"]) if isinstance(row, dict)
                                 else sum(len(part["events"]) for part in row)
                                for name, row in rows.items()}
                          for key, rows in learner["negatives"].items()},
            "dance": {"selfCompletions": {key: len(row["events"]) for key, row in learner["dance"]["selfReplay"].items()},
                      "reversedCompletions": len(learner["dance"]["reversed"]["events"]),
                      "learnerValidation": False},
        },
        "directionCollision": read("representation-collision.json"),
        "productionSelfReplay": production["selfReplay"],
        "modelBenchmarks": models,
        "productionLearner": [],
        "sourceModelHashes": {},
        "caveats": ["Diagnostic candidate is not the production matcher.",
                    "Geometric oracle uses old grouped/cropped annotations, not online recognition.",
                    "Segmentation cadence tests use one MediaPipe extraction, not independent native/browser MediaPipe inference.",
                    "Reduced descriptor aliases distinct physical directions and is rejected as a generic representation.",
                    "Tests do not establish universal model impossibility; the tested alternatives remain insufficient."],
    }
    for name in ROOT.glob("production-learner-*.json"):
        result = read(name.name)
        windows = [("front-1", 9000, 14000), ("front-2", 14000, 18000),
                   ("side-1", 23000, 28000), ("side-2", 28000, 33000),
                   ("setup-walking", 0, 9000), ("turn-standing", 18000, 23000), ("exit", 33000, 40000)]
        observed = {}
        for label, start, end in windows:
            rows = [row for row in result["trace"] if start <= row["timestampMs"] < end]
            observed[label] = {"frames": len(rows),
                               "maximumProgressPercent": max([0] + [row.get("currentProgressPercent", 0) for row in rows]),
                               "repetitions": sum(isinstance(row.get("event"), dict) and row["event"].get("type") == "REP_SUCCESS" for row in rows)}
        report["productionLearner"].append({"artifact": name.name, "summary": result["summary"],
                                           "calibration": result["calibration"], "evaluationEvents": result["evaluationEvents"],
                                           "annotatedWindowsReportingOnly": observed})
    for model in (Path("public/models/pose_landmarker_full.task"), Path("data/diagnostic-models/pose_landmarker_heavy.task")):
        if model.exists():
            report["sourceModelHashes"][str(model)] = hashlib.sha256(model.read_bytes()).hexdigest()
    (ROOT / "summary.json").write_text(json.dumps(report, indent=2))
    print(json.dumps({"conclusion": report["conclusion"], "experiments": len(report["experiments"]),
                      "modelBenchmarks": models, "productionLearnerRuns": len(report["productionLearner"])}))


if __name__ == "__main__":
    main()
