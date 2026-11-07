"""RTMW3D inference, camera reconstruction, and body-centric bone features."""
import contextlib
import os
import sys
import time
import json
import hashlib
from pathlib import Path

import cv2
import numpy as np

CHECKPOINT = "rtmw3d-x_8xb64_cocktail14-384x288-b0a0eab7_20240626"
JOINTS = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
MP = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]
BONES = [(11, 5), (12, 6), (5, 7), (7, 9), (6, 8), (8, 10),
         (11, 13), (13, 15), (12, 14), (14, 16), (5, 6), (11, 12)]
CONFIDENCE = 0.5  # RTMLib's documented 3D visualization confidence floor, not MediaPipe visibility.


def body_skeleton(points, confidence, depth_confidence=None):
    points = np.asarray(points, dtype=float)
    confidence = np.asarray(confidence, dtype=float)
    root = (points[11] + points[12]) / 2
    torso = (points[5] + points[6]) / 2 - root
    scale = float(np.linalg.norm(torso))
    reliable_root = min(confidence[[5, 6, 11, 12]]) >= CONFIDENCE
    if not np.isfinite(points).all() or scale < 1e-6:
        raise ValueError("Degenerate RTMW3D skeleton")
    lateral = points[12] - points[11] + points[6] - points[5]
    lateral[1] = 0
    left_right_agree = np.dot(points[12] - points[11], points[6] - points[5]) > 0
    orientable = bool(reliable_root and left_right_agree and np.linalg.norm(lateral) > scale * 0.1)
    basis = np.eye(3)
    if orientable:
        x = lateral / np.linalg.norm(lateral)
        y = np.array([0., 1., 0.])
        z = np.cross(x, y)
        basis = np.stack([x, y, z])
    normalized = (points - root) @ basis.T / scale
    vectors, bone_conf = [], []
    for a, b in BONES:
        vector = normalized[b] - normalized[a]
        length = np.linalg.norm(vector)
        vectors.append((vector / max(length, 1e-9)).tolist())
        bone_conf.append(float(min(confidence[a], confidence[b])))
    return dict(representation="rtmw3d-body-v1", checkpoint=CHECKPOINT,
                joints=normalized[JOINTS].tolist(), confidence=confidence[JOINTS].tolist(),
                bones=vectors, boneConfidence=bone_conf, orientationReliable=orientable,
                root=root.tolist(), scale=scale, basis=basis.tolist(),
                depthConfidence=[] if depth_confidence is None else np.asarray(depth_confidence)[JOINTS].tolist(),
                cameraAssumption="uncalibrated-mmpose-default-focal-root-depth")


class SkeletonModel:
    def __init__(self):
        from rtmlib.tools.pose_estimation.rtmpose3d import RTMPose3d
        import onnxruntime as ort
        path = Path(os.environ.get("SKILLPRINT_RTMW3D_MODEL", f".movement-models/{CHECKPOINT}.onnx"))
        if not path.exists() or not path.with_suffix(".provenance.json").exists():
            raise RuntimeError("RTMW3D weights/provenance missing. Run the explicit model installer; see docs/RTMW3D_MODEL.md")
        provenance = json.loads(path.with_suffix(".provenance.json").read_text())
        with path.open("rb") as weights:
            digest = hashlib.file_digest(weights,"sha256").hexdigest()
        if provenance.get("checkpoint") != CHECKPOINT or not provenance.get("acknowledgement") or provenance.get("sha256") != digest:
            raise RuntimeError("Model checkpoint/provenance integrity check failed")
        with contextlib.redirect_stdout(sys.stderr):
            self.model = RTMPose3d(str(path), backend="onnxruntime", device="cpu")
        options = ort.SessionOptions()
        options.intra_op_num_threads = int(os.environ.get("SKILLPRINT_INFERENCE_THREADS", "4"))
        providers = ["CPUExecutionProvider"]
        if "DmlExecutionProvider" in ort.get_available_providers():
            providers.insert(0, "DmlExecutionProvider")
            options.enable_mem_pattern = False
            options.execution_mode = ort.ExecutionMode.ORT_SEQUENTIAL
        self.model.session = ort.InferenceSession(str(path), sess_options=options, providers=providers)
        self.providers = self.model.session.get_providers()
        self.regions = {}

    def infer(self, image, timestamp, stream_id=None):
        start = time.perf_counter()
        height, width = image.shape[:2]
        # RTMW3D is top-down; the current product contract is one fully framed person.
        # RGB conversion follows MMPose's bgr_to_rgb preprocessor.
        previous = self.regions.get(stream_id) if stream_id else None
        region = previous[1] if previous and 0 < timestamp - previous[0] <= 500 else None
        rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        with contextlib.redirect_stdout(sys.stderr):
            keypoints, scores, _, pixels = self.model(rgb, bboxes=[] if region is None else [region])
            visible = scores[0, :17] >= 0.3
            if visible.sum() >= 6:
                bounds = pixels[0, :17][visible]
                lo, hi = bounds.min(axis=0), bounds.max(axis=0)
                extent = hi - lo
                # Bootstrap a single-person ROI from this model's own image keypoints.
                # No extra detector model, fixture region, or viewpoint label is used.
                if extent[1] > height * .15:
                    lo = np.maximum([0, 0], lo - extent * .15)
                    hi = np.minimum([width, height], hi + extent * .15)
                    region = [float(lo[0]), float(lo[1]), float(hi[0]), float(hi[1])]
                    if previous is None:
                        keypoints, scores, _, pixels = self.model(rgb, bboxes=[region])
                    if stream_id:
                        if len(self.regions) > 32:
                            self.regions.clear()
                        self.regions[stream_id] = (timestamp, region)
        points = keypoints[0].astype(float)
        pixels = pixels[0].astype(float)
        # The upstream codec's depth is in metres, while x/y are pixels. Reconstruct
        # camera coordinates before any 3D rotation, never mix these units.
        depth = points[:, 2] + 5.14388
        camera = np.column_stack([(pixels[:, 0] - width / 2) / 1145.04940459 * depth,
                                  (pixels[:, 1] - height / 2) / 1143.78109572 * depth, depth])
        confidence = np.clip(scores[0], 0, 1)
        body = body_skeleton(camera, confidence)
        body["imageSize"] = [width, height]
        landmarks = [dict(x=0., y=0., z=0., visibility=0.) for _ in range(33)]
        overlay_mapping = [(0,0),(1,2),(2,5),(3,7),(4,8),(71,9),(77,10),
                           (111,17),(132,18),(99,19),(120,20),(95,21),(116,22),
                           (19,29),(22,30),(17,31),(20,32), *zip(JOINTS, MP)]
        for coco, mp in overlay_mapping:
            landmarks[mp] = dict(x=float(pixels[coco, 0] / width), y=float(pixels[coco, 1] / height),
                                 z=float(points[coco, 2]), visibility=float(confidence[coco]))
        return dict(timestampMs=timestamp, landmarks=landmarks, worldLandmarks=[], bodySkeleton=body,
                    inferenceMs=(time.perf_counter() - start) * 1000, providers=self.providers)
