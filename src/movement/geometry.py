"""Unchanged confidence-masked RTMW3D geometry shared by live/offline matching."""
import math

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
