"""Teacher-first gates through the production NDJSON worker; never tune on learners."""
import argparse
import copy
from collections import Counter
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import uuid

import numpy as np

from geometry import distance, vector


class ProductionWorker:
    def __init__(self):
        self.process = subprocess.Popen([sys.executable, str(Path(__file__).with_name("worker.py"))],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8")
        self.serial = 0

    def request(self, **request):
        self.serial += 1
        self.process.stdin.write(json.dumps(dict(id=str(self.serial), **request), allow_nan=False) + "\n")
        self.process.stdin.flush()
        response = json.loads(self.process.stdout.readline())
        if "error" in response:
            raise RuntimeError(response["error"])
        return response["result"]

    def close(self):
        self.process.stdin.close()
        self.process.wait(timeout=15)


class ProductionHTTP:
    def __init__(self, base):
        import requests
        self.session = requests.Session()
        self.url = base.rstrip("/") + "/api/movement"

    def request(self, **request):
        request["runId"] = str(uuid.uuid5(uuid.NAMESPACE_URL, request["runId"]))
        response = self.session.post(self.url, json=request, timeout=30)
        response.raise_for_status()
        return response.json()

    def close(self):
        self.session.close()


def resampled(frames, density):
    if density == .5:
        indices = sorted(set([*range(0, len(frames), 2), len(frames) - 1]))
        return [frames[i] for i in indices]
    if density == 1:
        return frames
    if density == "drops":
        return [frame for i, frame in enumerate(frames) if i in (0, len(frames) - 1) or i % 7 != 3]
    result = []
    for a, b in zip(frames, frames[1:]):
        result.append(a)
        middle = copy.deepcopy(a)
        middle["timestampMs"] = (a["timestampMs"] + b["timestampMs"]) / 2
        skeleton = middle["bodySkeleton"]
        for field in ("bones", "joints"):
            values = (np.array(a["bodySkeleton"][field]) + np.array(b["bodySkeleton"][field])) / 2
            if field == "bones":
                values /= np.maximum(np.linalg.norm(values, axis=1, keepdims=True), 1e-12)
            skeleton[field] = values.tolist()
        for field in ("confidence", "boneConfidence"):
            skeleton[field] = np.minimum(a["bodySkeleton"][field], b["bodySkeleton"][field]).tolist()
        skeleton["orientationReliable"] = a["bodySkeleton"]["orientationReliable"] and b["bodySkeleton"]["orientationReliable"]
        result.append(middle)
    return result + [frames[-1]]


def replay(worker, canonical, frames, difficulty, key, output):
    worker.request(operation="start", runId=key, canonical=canonical, difficulty=difficulty, leniency=.25)
    rows = []
    try:
        for frame in frames:
            reply = worker.request(operation="align", runId=key, pose=frame)
            reply.pop("alignedSample", None)
            rows.append(dict(timestampMs=frame["timestampMs"], **reply))
    finally:
        worker.request(operation="finish", runId=key)
    (output / f"{key}-raw.json").write_text(json.dumps(rows), encoding="utf-8")
    anchors = list(dict.fromkeys(r["lastSatisfiedAnchor"] for r in rows if r["lastSatisfiedAnchor"]))
    return dict(key=key, difficulty=difficulty, frames=len(frames), usable=sum(r["usable"] for r in rows),
                repetitions=sum(r["event"] == "REP_SUCCESS" for r in rows),
                sequenceCompletions=sum(r["event"] == "SEQUENCE_COMPLETE" for r in rows),
                maximumProgress=max((r["currentProgressPercent"] for r in rows), default=0),
                anchors=anchors, reasons=dict(Counter(r["reason"] for r in rows)),
                alignmentMeanMs=float(np.mean([r["alignmentMs"] for r in rows])),
                alignmentP95Ms=float(np.percentile([r["alignmentMs"] for r in rows], 95)))


def anchor_evidence(reference):
    frames = reference["sourceTrajectory"]
    result = []
    for anchor in reference["anchors"]:
        target = vector(anchor["pose"])
        runs, beginning, previous = [], None, None
        for frame in frames:
            v = vector(frame)
            timestamp = frame["timestampMs"]
            matches = v is not None and distance(v, target) <= .3125
            if beginning is not None and (not matches or timestamp - previous > 500):
                runs.append([beginning, previous, previous - beginning])
                beginning = None
            if matches and beginning is None:
                beginning = timestamp
            previous = timestamp
        if beginning is not None:
            runs.append([beginning, previous, previous - beginning])
        result.append(dict(anchor=anchor["id"], holdMs=anchor["holdMs"], matchingRuns=runs))
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", default="test-results/movement/local-aligner/gates")
    parser.add_argument("--engine", choices=["local", "before-dtw"], default="local")
    parser.add_argument("--http-base")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    native_path = Path("test-results/movement/3d/compiled.json")
    browser_path = Path("test-results/movement/3d/browser-movement-batched/teacher-cycle.json")
    sets = dict(annotated=json.loads(native_path.read_text())["combined"], browser=json.loads(browser_path.read_text())["lesson"]["canonicalMovement"])
    results = dict(engine=args.engine, productionProtocol=args.engine == "local", transport="http" if args.http_base else "ndjson",
                   inputSha256={str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in (native_path, browser_path)},
                   tolerance=.3125, holdMs=150, trackingGapMs=500, selfReplay=[], storedSamplesReplay=[], resampling=[], anchorEvidence={})
    if args.engine == "before-dtw":
        from alignment import OnlineAlignment

        class OfflineDTW:
            def __init__(self):
                self.runs = {}

            def request(self, **request):
                key = request["runId"]
                if request["operation"] == "start":
                    self.runs[key] = OnlineAlignment(request["canonical"], request["difficulty"], request["leniency"])
                elif request["operation"] == "align":
                    return self.runs[key].update(request["pose"])
                elif request["operation"] == "finish":
                    del self.runs[key]

            def close(self):
                pass

        worker = OfflineDTW()
    else:
        worker = ProductionHTTP(args.http_base) if args.http_base else ProductionWorker()
    try:
        for label, canonical in sets.items():
            for reference in canonical["references"]:
                if not reference["alignmentEligible"] or not reference["teacherConfirmed"]:
                    continue
                identity = reference["demonstrationId"]
                single = {**canonical, "references": [reference]}
                frames = reference["sourceTrajectory"]
                results["anchorEvidence"][f"{label}-{identity}"] = anchor_evidence(reference)
                for difficulty in (20, 50, 75, 80, 100):
                    key = f"{label}-{identity}-self-{difficulty}"
                    row = replay(worker, single, frames, difficulty, key, output)
                    results["selfReplay"].append(dict(set=label, reference=identity, **row))
                    print(json.dumps(row), flush=True)
                for density in (.5, 1, 2, "drops"):
                    key = f"{label}-{identity}-density-{density}"
                    row = replay(worker, single, resampled(frames, density), 75, key, output)
                    results["resampling"].append(dict(set=label, reference=identity, density=density, **row))
                key = f"{label}-{identity}-stored-samples"
                row = replay(worker, single, [s["pose"] for s in reference["samples"]], 75, key, output)
                results["storedSamplesReplay"].append(dict(set=label, reference=identity, **row))
        gate1 = [r for r in results["selfReplay"] if r["difficulty"] == 75]
        results["gate1Passed"] = bool(gate1) and all(r["repetitions"] == 1 for r in gate1)
        results["gate2Passed"] = bool(results["resampling"]) and all(r["repetitions"] == 1 for r in results["resampling"])
        results["crossDemonstration"] = []
        if results["gate1Passed"] and results["gate2Passed"]:
            for label, canonical in sets.items():
                eligible = [r for r in canonical["references"] if r["alignmentEligible"] and r["teacherConfirmed"]]
                for source in eligible:
                    for reference in eligible:
                        key = f"{label}-{source['demonstrationId']}-against-{reference['demonstrationId']}"
                        row = replay(worker, {**canonical, "references": [reference]}, source["sourceTrajectory"], 75, key, output)
                        results["crossDemonstration"].append(dict(set=label, source=source["demonstrationId"], reference=reference["demonstrationId"], **row))
        results["learnerEvaluationAuthorized"] = results["gate1Passed"] and results["gate2Passed"]
        (output / "summary.json").write_text(json.dumps(results, indent=2), encoding="utf-8")
        print(json.dumps({k: results[k] for k in ("gate1Passed", "gate2Passed", "learnerEvaluationAuthorized")}), flush=True)
    finally:
        worker.close()


if __name__ == "__main__":
    main()
