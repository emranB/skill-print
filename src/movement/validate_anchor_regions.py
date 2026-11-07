"""Frozen teacher-only region construction gates, using the production worker path."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path

from validate_local_alignment import ProductionHTTP, ProductionWorker, replay, resampled
from geometry import distance, vector
from local_alignment import HOLD_OBSERVATION_GAP_MS


def execution_variant(frames, variant):
    if variant in (.5, 1, 2, "drops"):
        return resampled(frames, variant)
    result = copy.deepcopy(frames)
    origin = frames[0]["timestampMs"]
    factor = .5 if variant == "faster" else 2.
    for frame in result:
        frame["timestampMs"] = origin + (frame["timestampMs"] - origin) * factor
    return result


def succeeded(row, kind):
    return row["repetitions" if kind == "cycle" else "sequenceCompletions"] == 1


def region_support(reference):
    diagnostics = []
    for anchor in reference["anchors"]:
        targets = [vector(p) for p in anchor["region"]["samples"]]
        intervals, start, previous = [], None, None
        for frame in reference["sourceTrajectory"]:
            timestamp, v = frame["timestampMs"], vector(frame)
            error = min((distance(v, t) for t in targets), default=math.inf) if v is not None else math.inf
            supported = error <= .3125
            if start is not None and (not supported or timestamp - previous > HOLD_OBSERVATION_GAP_MS):
                intervals.append(dict(startMs=start,endMs=previous,durationMs=previous-start))
                start = None
            if supported and start is None:
                start = timestamp
            previous = timestamp
        if start is not None:
            intervals.append(dict(startMs=start,endMs=previous,durationMs=previous-start))
        diagnostics.append(dict(anchor=anchor["id"],sourceRegionStartMs=anchor["region"]["startMs"],
                                sourceRegionEndMs=anchor["region"]["endMs"],supportedIntervals=intervals))
    return diagnostics


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--http-base")
    parser.add_argument("--output", default="test-results/movement/anchor-regions/gates")
    args = parser.parse_args()
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    path = Path("test-results/movement/anchor-regions/compiled.json")
    compilation = json.loads(path.read_text())
    sets = {}
    for label, compiled in compilation["sets"].items():
        sets[label + "-physical"] = compiled
        sets[label + "-automatic"] = compiled["automatic"]["compilation"]
    sets["dance-sequence"] = compilation["dance"]
    result = dict(inputSha256=hashlib.sha256(path.read_bytes()).hexdigest(), tolerance=.3125, learnerHoldMs=0, holdsRequireExplicitTeacherRequest=True,
                  transport="http" if args.http_base else "production-ndjson", gateA=[], selfReplay=[], temporal=[], matrix=[], regionSupport=[])
    for label, compiled in sets.items():
        for reference in compiled["references"]:
            quality = copy.deepcopy(reference["quality"])
            for region in quality["regions"].values():
                if region:
                    region["sampleCount"] = len(region.pop("samples"))
            result["gateA"].append(dict(set=label, reference=reference["demonstrationId"], eligible=reference["alignmentEligible"],
                                       rejectionReason=reference.get("rejectionReason"), quality=quality))
    eligible = [(label, compiled["canonical"], reference) for label, compiled in sets.items() for reference in compiled["references"]
                if reference["alignmentEligible"] and reference["teacherConfirmed"]]
    result["gateAStructuralPassed"] = bool(eligible) and all(not ref["quality"]["rejectionReasons"] and all(
        len(a["region"]["samples"]) >= 2 and a["region"]["endMs"] > a["region"]["startMs"] for a in ref["anchors"]) for _, _, ref in eligible)
    result["nativePhysicalEligible"] = sum(row["eligible"] for row in result["gateA"] if row["set"] == "native-physical")
    worker = ProductionHTTP(args.http_base) if args.http_base else ProductionWorker()
    try:
        if result["gateAStructuralPassed"]:
            for label, canonical, reference in eligible:
                result["regionSupport"].append(dict(set=label,reference=reference["demonstrationId"],anchors=region_support(reference)))
                single = {**canonical, "references": [reference]}
                for difficulty in (20, 50, 75, 80, 100):
                    key = f"{label}-{reference['demonstrationId']}-self-{difficulty}"
                    row = replay(worker, single, reference["sourceTrajectory"], difficulty, key, output)
                    result["selfReplay"].append(dict(set=label, reference=reference["demonstrationId"], kind=canonical["kind"], **row))
                    print(json.dumps(row), flush=True)
        gate_b = [r for r in result["selfReplay"] if r["difficulty"] == 75]
        result["gateBPassed"] = bool(gate_b) and all(succeeded(r, r["kind"]) for r in gate_b)
        if result["gateBPassed"]:
            for label, canonical, reference in eligible:
                for variant in (.5, 1, 2, "drops", "faster", "slower"):
                    key = f"{label}-{reference['demonstrationId']}-{variant}"
                    row = replay(worker, {**canonical, "references": [reference]}, execution_variant(reference["sourceTrajectory"], variant),75,key,output)
                    result["temporal"].append(dict(set=label,reference=reference["demonstrationId"],variant=variant,kind=canonical["kind"],**row))
        result["gateCPassed"] = bool(result["temporal"]) and all(succeeded(r,r["kind"]) for r in result["temporal"])
        if result["gateBPassed"] and result["gateCPassed"]:
            for label, compiled in sets.items():
                if not label.endswith("-physical") or not compiled["canonical"]:
                    continue
                canonical = compiled["canonical"]
                for source in compiled["references"]:
                    for reference in canonical["references"]:
                        if not reference["alignmentEligible"]:
                            continue
                        key = f"{label}-{source['demonstrationId']}-against-{reference['demonstrationId']}"
                        row = replay(worker,{**canonical,"references":[reference]},source["sourceTrajectory"],75,key,output)
                        result["matrix"].append(dict(set=label,source=source["demonstrationId"],reference=reference["demonstrationId"],**row))
        valid = [(label,ref) for label,_,ref in eligible if label.endswith("-physical")]
        result["gateDPassed"] = bool(valid) and all(any(row["set"] == label and row["source"] == ref["demonstrationId"] and
            row["reference"] != ref["demonstrationId"] and row["repetitions"] == 1 for row in result["matrix"]) for label,ref in valid)
        result["learnerEvaluationAuthorized"] = all(result.get(key, False) for key in ("gateAStructuralPassed","gateBPassed","gateCPassed","gateDPassed"))
        result["stoppedAt"] = next((key for key in ("gateAStructuralPassed","gateBPassed","gateCPassed","gateDPassed") if not result[key]), None)
        result["gateStatus"] = dict(A="structural_pass" if result["gateAStructuralPassed"] else "failed",
                                   B="passed" if result["gateBPassed"] else "failed" if result["selfReplay"] else "blocked",
                                   C="passed" if result["gateCPassed"] else "failed" if result["temporal"] else "blocked",
                                   D="passed" if result["gateDPassed"] else "failed" if result["matrix"] else "blocked", E="blocked")
        (output / "summary.json").write_text(json.dumps(result,indent=2),encoding="utf-8")
        print(json.dumps({key:result[key] for key in ("nativePhysicalEligible","gateAStructuralPassed","gateBPassed","gateCPassed","gateDPassed","stoppedAt","learnerEvaluationAuthorized")}),flush=True)
    finally:
        worker.close()


if __name__ == "__main__":
    main()
