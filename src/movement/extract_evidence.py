"""Fixture-only empirical recording. Never imported by production."""
import argparse
import json
import platform
import time
from pathlib import Path

import cv2
import numpy as np
from skeleton import SkeletonModel

parser = argparse.ArgumentParser()
parser.add_argument("videos", nargs="+")
parser.add_argument("--output", default="test-results/movement/3d")
args = parser.parse_args()
directory = Path(args.output)
directory.mkdir(parents=True, exist_ok=True)
model = SkeletonModel()
for source in args.videos:
    target = directory / (Path(source).stem + "-rtmw3d.json")
    if target.exists():
        print(f"Preserving existing extraction {target}", flush=True)
        continue
    capture = cv2.VideoCapture(source)
    native_fps = capture.get(cv2.CAP_PROP_FPS)
    count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT))
    rows, timings = [], []
    started = time.perf_counter()
    next_time = 0.
    index = 0
    while True:
        ok, image = capture.read()
        if not ok:
            break
        timestamp = index * 1000 / native_fps
        index += 1
        if timestamp + 1e-6 < next_time:
            continue
        next_time += 1000 / 15
        height, width = image.shape[:2]
        scale = min(1., 640 / max(height, width))
        image = cv2.resize(image, (round(width * scale), round(height * scale)))
        try:
            row = model.infer(image, timestamp, source)
            rows.append(row)
            timings.append(row["inferenceMs"])
        except ValueError as error:
            rows.append(dict(timestampMs=timestamp, error=str(error)))
        if len(rows) % 150 == 0:
            print(source, len(rows), flush=True)
    capture.release()
    result = dict(source=source, nativeFps=native_fps, nativeFrames=count, sampleFps=15,
                  hardware=platform.platform(), providers=model.providers, frames=rows,
                  inferenceMeanMs=float(np.mean(timings)), inferenceP95Ms=float(np.percentile(timings,95)),
                  elapsedSeconds=time.perf_counter()-started)
    target.write_text(json.dumps(result))
    print(source, len(rows), result["inferenceMeanMs"], result["inferenceP95Ms"], flush=True)
