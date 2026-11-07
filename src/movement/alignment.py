"""Causal reference-set alignment. DTAIDistance owns the multidimensional DTW."""
import math
import time

from dtaidistance import dtw_ndim
import numpy as np

from skeleton import CONFIDENCE


def vector(pose):
    skeleton = pose.get("bodySkeleton", pose)
    if skeleton.get("representation") != "rtmw3d-body-v1":
        raise ValueError("RTMW3D references require real versioned 3D skeletons, not legacy landmarks")
    if not skeleton["orientationReliable"] or sum(c >= CONFIDENCE for c in skeleton["boneConfidence"]) < 6:
        return None
    result = np.column_stack([skeleton["bones"], skeleton["boneConfidence"]]).astype(np.double).reshape(-1)
    return result if np.isfinite(result).all() else None


def distance(a, b):
    return math.sqrt(SkeletonCost.inner_dist(a, b))


class SkeletonCost:
    @staticmethod
    def inner_dist(a, b):
        a, b = a.reshape(-1, 4), b.reshape(-1, 4)
        mask = np.minimum(a[:, 3], b[:, 3]) >= CONFIDENCE
        if mask.sum() < 6:
            return math.inf
        return float(np.mean(np.sum((a[mask, :3] - b[mask, :3]) ** 2, axis=1)))

    @staticmethod
    def result(value):
        return np.sqrt(value)

    @staticmethod
    def inner_val(value):
        return value * value


def arc_positions(vectors):
    increments = [0.] + [distance(a, b) for a, b in zip(vectors, vectors[1:])]
    lengths = np.cumsum(increments)
    return lengths, float(lengths[-1])


def resample(vectors, spacing, limit=2048, lengths=None):
    if lengths is None:
        lengths, total = arc_positions(vectors)
    else:
        lengths = np.asarray(lengths)
        total = float(lengths[-1])
    if total < 1e-9:
        return np.ascontiguousarray([vectors[0]], dtype=np.double)
    positions = np.arange(0, total - 1e-9, max(spacing, 1e-6))
    positions = np.append(positions[:limit - 1], total)
    return np.ascontiguousarray(np.column_stack([np.interp(positions, lengths, np.asarray(vectors)[:, d])
                                               for d in range(len(vectors[0]))]), dtype=np.double)


def constrained_dtw(learner, teacher, tolerance):
    """No open-end relaxation. Bounded warping plus an explicit slope/path audit."""
    # A path with at most two consecutive axis steps cannot exceed a 3:1 ratio.
    if not len(learner) or not len(teacher) or max(len(learner), len(teacher)) > 3 * min(len(learner), len(teacher)):
        return None
    window = max(2, math.ceil(max(len(learner), len(teacher)) * 0.15))
    path = dtw_ndim.warping_path(learner, teacher, use_c=False, window=window,
                                 max_step=tolerance, penalty=0.02, psi=0, inner_dist=SkeletonCost)
    if not path or path[0] != (0, 0) or path[-1] != (len(learner) - 1, len(teacher) - 1):
        return None
    horizontal = vertical = 0
    for (a, b), (c, d) in zip(path, path[1:]):
        horizontal = horizontal + 1 if a == c else 0
        vertical = vertical + 1 if b == d else 0
        if max(horizontal, vertical) > 2:
            return None
    costs = [distance(learner[a], teacher[b]) for a, b in path]
    if max(costs) > tolerance:
        return None
    return dict(distance=float(np.sqrt(np.mean(np.square(costs)))), path=path,
                window=window, maximumPairDistance=max(costs))


class Candidate:
    def __init__(self, reference, kind, difficulty, tolerance):
        self.reference = reference
        self.kind = kind
        self.tolerance = tolerance
        self.interval = max(1, 100 - round(min(100, max(1, difficulty)))) / 100
        samples = reference["samples"]
        self.phases = []
        anchors = reference["anchors"]
        for start, end in zip(anchors, anchors[1:]):
            part = [s for s in samples if start["progress01"] <= s["progress01"] <= end["progress01"]]
            vectors = [vector(s["pose"]) for s in part]
            if any(v is None for v in vectors):
                raise ValueError("Reference contains unreliable 3D bones; review/re-record this demonstration")
            lengths, total = arc_positions(vectors)
            positions = sorted(set([0., 1., *np.arange(self.interval, 1, self.interval).tolist()]))
            targets = []
            for fraction in positions:
                index = int(np.argmin(np.abs(lengths - fraction * total)))
                targets.append((fraction, vectors[index], part[index]))
            # Dense teacher geometry remains available for the anti-collapse motion test.
            excursion = max(distance(vectors[0], v) for v in vectors)
            self.phases.append(dict(targets=targets, dense=part, vectors=vectors, positions=lengths / max(total, 1e-9), arc=total, excursion=excursion, start=start, end=end))
        self.target_count = sum(len(p["targets"]) - 1 for p in self.phases) + 1
        self.reset()

    def reset(self):
        self.phase = -1
        self.progress = 0.
        self.hold = None
        self.observed = []
        self.observed_lengths = [0.]
        self.observed_reach = 0.
        self.raw_count = 0
        self.endpoint = 0
        self.phase_progress = 0.
        self.sample = self.phases[0]["start"]
        self.score = 0.
        self.dtw_distance = None
        self.complete = False
        self.reason = "awaiting_start"
        self.last_anchor = None
        self.last_timestamp = -math.inf

    def current_sample(self):
        return self.sample

    def update(self, v, timestamp):
        if self.complete or timestamp <= self.last_timestamp:
            return None
        gap = timestamp - self.last_timestamp
        self.last_timestamp = timestamp
        if v is None or gap > 500:
            self.hold = None
            if self.phase >= 0:
                # Never interpolate unobserved motion across tracking loss.
                self.reason = "tracking_gap_restart"
                self.reset()
                self.last_timestamp = timestamp
            if v is None:
                self.reason = "tracking_invalid"
                return None
        p = self.phases[max(0, self.phase)]
        if p["excursion"] < 1e-6:
            self.reason = "invalid_reference_no_motion"
            return None
        if self.phase < 0:
            self.score = max(0., 1 - distance(v, p["targets"][0][1]) / 1.25)
            if distance(v, p["targets"][0][1]) <= self.tolerance:
                if self.hold is None:
                    self.hold = timestamp
                if timestamp - self.hold >= p["start"]["holdMs"]:
                    self.phase = 0
                    self.last_anchor = "start"
                    self.hold = None
                    self.observed = [v]
                    self.reason = "start_satisfied"
            else:
                self.hold = None
            return None
        step = distance(self.observed[-1], v) if self.observed else 0.
        if self.observed and step > self.tolerance:
            self.reset()
            self.last_timestamp = timestamp
            self.reason = "unsupported_motion_jump"
            return None
        self.raw_count += 1
        if not self.observed or step > 1e-4:
            self.observed_lengths.append(self.observed_lengths[-1] + step)
            self.observed_reach = max(self.observed_reach, distance(self.observed[0], v))
            self.observed.append(v)
        if len(self.observed) > 2048:
            self.reset()
            self.reason = "attempt_buffer_limit"
            return None
        self.score = max(0., 1 - distance(v, p["targets"][self.endpoint][1]) / 1.25)
        # Progress reach is geometric, not elapsed time, FPS, or runtime target count.
        reach = self.observed_reach
        observed_arc = self.observed_lengths[-1]
        upper = min(1., self.phase_progress + 0.15)
        best = None
        endpoints = [(index, fraction, target) for index, (fraction, target) in enumerate(zip(p["positions"], p["vectors"]))
                     if self.phase_progress - 1e-9 <= fraction <= upper + 1e-9]
        # Score the closest causal endpoint, not a DTW solve for every dense sample.
        endpoints.sort(key=lambda item: (distance(v, item[2]), -item[1]))
        for index, fraction, target in endpoints[:1]:
            if fraction < self.phase_progress - 1e-9 or fraction > upper + 1e-9 or distance(v, target) > self.tolerance:
                continue
            if index == 0:
                continue
            if fraction * p["arc"] > observed_arc + self.tolerance:
                continue
            teacher = np.ascontiguousarray([t[1] for t in p["targets"] if t[0] < fraction - 1e-9] + [target], dtype=np.double)
            spacing = max(1e-6, p["arc"] * self.interval)
            learner = resample(self.observed, spacing, lengths=self.observed_lengths)
            aligned = constrained_dtw(learner, teacher, self.tolerance)
            if aligned is not None and (best is None or fraction > best[2]):
                best = (index, aligned, fraction)
        if best:
            dense_index, aligned, self.phase_progress = best
            self.endpoint = max(i for i, t in enumerate(p["targets"]) if t[0] <= self.phase_progress + 1e-9)
            self.sample = p["dense"][dense_index]
            self.dtw_distance = aligned["distance"]
            self.score = max(0., 1 - aligned["distance"] / 1.25)
            a, b = p["start"]["progress01"], p["end"]["progress01"]
            self.progress = max(self.progress, a + (b - a) * self.phase_progress)
            self.reason = "causal_dtw_alignment"
        at_end = self.phase_progress >= 1 - 1e-9
        enough_motion = self.raw_count >= 3 and len(self.observed) >= 3 and reach >= p["excursion"] * 0.5
        if at_end and enough_motion and distance(v, p["targets"][-1][1]) <= self.tolerance:
            if self.hold is None:
                self.hold = timestamp
            self.reason = "anchor_hold"
            if timestamp - self.hold >= p["end"]["holdMs"]:
                self.last_anchor = p["end"]["id"]
                self.hold = None
                self.phase += 1
                if self.phase == len(self.phases):
                    self.phase -= 1
                    self.complete = True
                    return "SEQUENCE_COMPLETE" if self.kind == "sequence" else "REP_SUCCESS"
                self.observed = [v]
                self.observed_lengths = [0.]
                self.observed_reach = 0.
                self.raw_count = 0
                self.endpoint = 0
                self.phase_progress = 0.
                self.sample = self.phases[self.phase]["start"]
        else:
            self.hold = None
        return None


class OnlineAlignment:
    def __init__(self, canonical, difficulty=75, leniency=0.25):
        if canonical.get("representation") != "rtmw3d-body-v1" or canonical.get("schemaVersion") != 3:
            raise ValueError("Expected a versioned RTMW3D reference set")
        self.kind = canonical["kind"]
        self.candidates = [Candidate(ref, self.kind, difficulty, leniency * 1.25)
                           for ref in canonical["references"] if ref.get("alignmentEligible") is True and ref.get("teacherConfirmed") is True]
        if not self.candidates:
            raise ValueError("No confirmed reliable RTMW3D references")
        self.maximum = 0.
        self.progress = 0.
        self.reps = 0
        self.finished = False
        self.last_timestamp = -math.inf

    def update(self, pose):
        start = time.perf_counter()
        timestamp = pose["timestampMs"]
        v = vector(pose)
        event = None
        winner = None
        if not self.finished and timestamp > self.last_timestamp:
            self.last_timestamp = timestamp
            for candidate in self.candidates:
                result = candidate.update(v, timestamp)
                if result:
                    event = result
                    winner = candidate
                    break
        best = winner or max(self.candidates, key=lambda c: (c.progress, c.score))
        self.progress = max(self.progress, best.progress)
        self.maximum = max(self.maximum, self.progress)
        sample = best.current_sample()
        response = dict(event=event, referenceId=best.reference["demonstrationId"], similarity=best.score,
                        normalizedDtwDistance=best.dtw_distance, currentProgressPercent=self.progress * 100,
                        furthestProgressPercent=self.maximum * 100, currentPhase=sample["phase"],
                        lastSatisfiedAnchor=best.last_anchor, runtimeTargetCount=best.target_count,
                        runtimeTargetIndex=best.endpoint, reason=best.reason, alignedSample=sample,
                        usable=v is not None, alignmentMs=(time.perf_counter() - start) * 1000)
        if event == "REP_SUCCESS":
            self.reps += 1
            for candidate in self.candidates:
                candidate.reset()
            self.progress = 0.
        elif event == "SEQUENCE_COMPLETE":
            self.finished = True
        return response
