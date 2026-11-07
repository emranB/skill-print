"""Causal local reference cursors. No dynamic programming or learner history."""
import math
import time

import numpy as np

from geometry import distance, vector
from skeleton import CONFIDENCE

FORWARD_REACH = 0.25  # Fraction of the current geometric phase, not target count/time.
TRACKING_GAP_MS = 500
CONFIDENCE_CONTINUITY_MS = 1000
HOLD_OBSERVATION_GAP_MS = 250


def requested_hold(anchor):
    """Old generated 150 ms values are not evidence of an explicit teacher request."""
    return anchor['holdMs'] if anchor.get('holdSource') == 'teacher_requested' else 0


def segment_distances(targets, a, b):
    """Support crossed targets using only the two consecutive observed poses."""
    targets = np.asarray(targets).reshape(-1, 12, 4)
    a, b = a.reshape(12, 4), b.reshape(12, 4)
    mask = np.minimum(targets[:, :, 3], np.minimum(a[:, 3], b[:, 3])) >= CONFIDENCE
    delta = (b[:, :3] - a[:, :3])[None, :, :] * mask[:, :, None]
    offset = (targets[:, :, :3] - a[:, :3]) * mask[:, :, None]
    denominator = np.sum(delta * delta, axis=(1, 2))
    fraction = np.clip(np.sum(offset * delta, axis=(1, 2)) / np.maximum(denominator, 1e-12), 0, 1)
    errors = np.sum((offset - fraction[:, None, None] * delta) ** 2, axis=(1, 2))
    counts = np.sum(mask, axis=1)
    return np.where(counts >= 6, np.sqrt(errors / np.maximum(counts, 1)), math.inf)


class LocalCandidate:
    def __init__(self, reference, kind, difficulty, tolerance):
        self.reference, self.kind, self.tolerance = reference, kind, tolerance
        self.regions = reference.get("anchorConstruction") == "observed-regions-v1"
        self.anchor_vectors = {}
        for anchor in reference["anchors"]:
            samples = anchor.get("region", {}).get("samples", []) if self.regions else [anchor["pose"]]
            vectors = [vector(pose) for pose in samples]
            if not vectors or any(v is None for v in vectors) or (self.regions and len(vectors) < 2):
                raise ValueError("Semantic regions require multiple reliable observed source poses")
            self.anchor_vectors[anchor["id"]] = np.array(vectors)
        interval = max(1, 100 - round(min(100, max(1, difficulty)))) / 100
        self.phases = []
        for start, end in zip(reference["anchors"], reference["anchors"][1:]):
            samples = [s for s in reference["samples"] if start["progress01"] <= s["progress01"] <= end["progress01"]]
            vectors = [vector(s["pose"]) for s in samples]
            if len(vectors) < 2 or any(v is None for v in vectors):
                raise ValueError("Reference contains unreliable 3D bones; review/re-record this demonstration")
            positions = np.array([(s["progress01"] - start["progress01"]) / (end["progress01"] - start["progress01"]) for s in samples])
            fractions = np.array([0., *np.arange(interval, 1 - 1e-9, interval).tolist(), 1.])
            target_indices = [int(np.argmin(np.abs(positions - f))) for f in fractions]
            region_poses = end.get("region", {}).get("samples", []) if self.regions else []
            region_indices = [i for i, sample in enumerate(samples) if any(sample["pose"]["bodySkeleton"] == pose["bodySkeleton"] for pose in region_poses)]
            region_start = float(positions[min(region_indices)]) if region_indices else 1.
            self.phases.append(dict(start=start, end=end, samples=samples, vectors=np.array(vectors), positions=positions,
                                    fractions=fractions, targets=np.array(vectors)[target_indices],
                                    end_region_start=region_start,
                                    excursion=max(distance(vectors[0], v) for v in vectors)))
        self.target_count = sum(len(p["fractions"]) - 1 for p in self.phases) + 1
        self.reset()

    def reset(self):
        self.phase = -1
        self.phase_position = 0.
        self.progress = 0.
        self.endpoint = 0
        self.hold = None
        self.previous = None
        self.origin = None
        self.reach = 0.
        self.changes = 0
        self.score = 0.
        self.local_distance = None
        self.last_anchor = None
        self.last_timestamp = -math.inf
        self.last_supported_timestamp = -math.inf
        self.last_reliable_timestamp = -math.inf
        self.missing = False
        self.complete = False
        self.reason = "awaiting_start"
        self.sample = self.phases[0]["start"]

    def current_sample(self):
        return self.sample

    def anchor_distance(self, anchor, v):
        return float(np.min(segment_distances(self.anchor_vectors[anchor["id"]], v, v)))

    def crossing_supported(self, p, destination, v):
        crossed = p["targets"][(p["fractions"] > self.phase_position + 1e-9) & (p["fractions"] <= destination + 1e-9)]
        return not len(crossed) or bool(np.all(segment_distances(crossed, self.previous, v) <= self.tolerance))

    def advance(self, p, index, error):
        self.phase_position = float(p["positions"][index])
        self.sample = p["samples"][index]
        a, b = p["start"]["progress01"], p["end"]["progress01"]
        self.progress = max(self.progress, a + (b - a) * self.phase_position)
        self.endpoint = sum(len(q["fractions"]) - 1 for q in self.phases[:self.phase]) + int(np.searchsorted(p["fractions"], self.phase_position + 1e-9, side="right") - 1)
        self.local_distance = error
        self.score = max(0., 1 - error / 1.25)

    def update(self, v, timestamp):
        if self.complete or timestamp <= self.last_timestamp:
            return None
        gap = timestamp - self.last_timestamp
        self.last_timestamp = timestamp
        reset_reason = None
        if self.regions and v is None:
            if timestamp - self.last_reliable_timestamp > CONFIDENCE_CONTINUITY_MS:
                self.reset()
                self.last_timestamp = timestamp
            self.hold = None
            self.missing = True
            self.score = 0.
            self.reason = "confidence_gap_no_progress"
            return None
        reliable_gap = timestamp - self.last_reliable_timestamp
        continuity_lost = self.regions and (self.missing or reliable_gap > TRACKING_GAP_MS) and (reliable_gap > CONFIDENCE_CONTINUITY_MS or
                           self.previous is not None and distance(self.previous, v) > self.tolerance)
        if v is None or (continuity_lost if self.regions else gap > TRACKING_GAP_MS):
            active = self.phase >= 0
            self.reset()
            self.last_timestamp = timestamp
            if v is None:
                self.reason = "tracking_invalid"
                return None
            if active:
                reset_reason = "tracking_gap_restart"
        if self.regions and (self.missing or gap > HOLD_OBSERVATION_GAP_MS):
            # Confidence gaps preserve a coherent cursor, never inferred motion or hold time.
            self.hold = None
            if self.previous is not None:
                self.previous = v
            self.last_supported_timestamp = timestamp
        self.missing = False
        self.last_reliable_timestamp = timestamp
        p = self.phases[max(0, self.phase)]
        if p["excursion"] < 1e-6:
            self.reason = "invalid_reference_no_motion"
            return None
        if self.phase < 0:
            self.reason = reset_reason or "awaiting_start"
            error = self.anchor_distance(p["start"], v)
            self.local_distance = error if math.isfinite(error) else None
            self.score = max(0., 1 - error / 1.25)
            if error > self.tolerance:
                self.hold = None
                return None
            if self.hold is None:
                self.hold = timestamp
            if timestamp - self.hold >= requested_hold(p["start"]):
                self.phase = 0
                self.hold = None
                self.last_anchor = "start"
                self.previous = self.origin = v
                self.last_supported_timestamp = timestamp
                self.reason = "start_satisfied"
            return None

        if timestamp - self.last_supported_timestamp > TRACKING_GAP_MS:
            self.reset()
            self.last_timestamp = timestamp
            self.reason = "unsupported_tracking_restart"
            return None
        motion_step = distance(self.previous, v)
        if not math.isfinite(motion_step):
            self.reset()
            self.last_timestamp = timestamp
            self.reason = "tracking_common_bones_restart"
            return None
        upper = min(1., self.phase_position + FORWARD_REACH)
        indices = np.flatnonzero((p["positions"] >= self.phase_position - 1e-9) & (p["positions"] <= upper + 1e-9))
        errors = [(distance(v, p["vectors"][i]), int(i)) for i in indices]
        # Earliest equal-distance position prevents standing/duplicate poses creeping forward.
        errors.sort(key=lambda pair: (pair[0], p["positions"][pair[1]]))
        best = next(((error, i) for error, i in errors if error <= self.tolerance and self.crossing_supported(p, p["positions"][i], v)), None)
        end_error = self.anchor_distance(p["end"], v)
        region_supported = self.regions and end_error <= self.tolerance and self.phase_position + FORWARD_REACH >= 1 - 1e-9 and self.crossing_supported(p, p["end_region_start"], v)
        if best is None and region_supported:
            # Holding a semantic region must not additionally require its preview point.
            index = int(np.argmin(np.abs(p["positions"] - self.phase_position)))
            best = (end_error, index)
        if best is None:
            error = min((e for e, _ in errors), default=math.inf)
            self.local_distance = error if math.isfinite(error) else None
            self.score = max(0., 1 - error / 1.25)
            self.hold = None
            self.reason = "local_geometry_mismatch"
            return None
        error, index = best
        if motion_step > 1e-4:
            self.changes += 1
        excursion = distance(self.origin, v)
        if math.isfinite(excursion):
            self.reach = max(self.reach, excursion)
        self.advance(p, index, error)
        self.last_supported_timestamp = timestamp
        self.reason = "causal_local_alignment"

        enough_motion = self.changes >= 3 and self.reach >= p["excursion"] * 0.5
        # A hold begins while observed geometry supports the anchor, not only
        # after the cursor lands on its exact final sample. Crossing still waits.
        at_anchor = self.phase_position + FORWARD_REACH >= 1 - 1e-9 and end_error <= self.tolerance and self.crossing_supported(p, p["end_region_start"] if self.regions else 1., v)
        if at_anchor and enough_motion:
            if self.hold is None:
                self.hold = timestamp
            self.reason = "anchor_hold" if requested_hold(p['end']) else "trajectory_landmark"
            if timestamp - self.hold >= requested_hold(p["end"]) and upper >= 1 - 1e-9:
                self.advance(p, len(p["samples"]) - 1, end_error)
                self.last_anchor = p["end"]["id"]
                self.hold = None
                self.phase += 1
                if self.phase == len(self.phases):
                    self.phase -= 1
                    self.complete = True
                    return "SEQUENCE_COMPLETE" if self.kind == "sequence" else "REP_SUCCESS"
                self.phase_position = 0.
                self.origin = v
                self.reach = 0.
                self.changes = 0
                self.sample = self.phases[self.phase]["start"]
        else:
            self.hold = None
        self.previous = v
        return None


class LocalAlignment:
    def __init__(self, canonical, difficulty=75, leniency=0.25):
        if canonical.get("representation") != "rtmw3d-body-v1" or canonical.get("schemaVersion") != 3:
            raise ValueError("Expected a versioned RTMW3D reference set")
        self.kind = canonical["kind"]
        self.candidates = [LocalCandidate(ref, self.kind, difficulty, leniency * 1.25)
                           for ref in canonical["references"] if ref.get("alignmentEligible") is True and ref.get("teacherConfirmed") is True]
        if not self.candidates:
            raise ValueError("No confirmed reliable RTMW3D references")
        self.maximum = self.progress = 0.
        self.reps = 0
        self.finished = False
        self.last_timestamp = -math.inf

    def update(self, pose):
        start = time.perf_counter()
        timestamp, v = pose["timestampMs"], vector(pose)
        event = winner = None
        if not self.finished and timestamp > self.last_timestamp:
            self.last_timestamp = timestamp
            for candidate in self.candidates:
                result = candidate.update(v, timestamp)
                if result:
                    event, winner = result, candidate
                    break
        best = winner or max(self.candidates, key=lambda c: (c.progress, c.score))
        self.progress = best.progress
        self.maximum = max(self.maximum, self.progress)
        response = dict(event=event, referenceId=best.reference["demonstrationId"], similarity=best.score,
                        alignmentMethod="local_trajectory", localDistance=best.local_distance, normalizedDtwDistance=None,
                        currentProgressPercent=self.progress * 100, furthestProgressPercent=self.maximum * 100,
                        currentPhase=best.current_sample()["phase"], lastSatisfiedAnchor=best.last_anchor,
                        runtimeTargetCount=best.target_count, runtimeTargetIndex=best.endpoint,
                        reason=best.reason, alignedSample=best.current_sample(), usable=v is not None,
                        alignmentMs=(time.perf_counter() - start) * 1000)
        if event == "REP_SUCCESS":
            self.reps += 1
            for candidate in self.candidates:
                candidate.reset()
            self.progress = 0.
        elif event == "SEQUENCE_COMPLETE":
            self.finished = True
        return response
