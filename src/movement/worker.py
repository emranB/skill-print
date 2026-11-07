"""A long-lived JSON-lines worker, owned by the existing Express process."""
import base64
import json
import sys
import time
import traceback

import cv2
import numpy as np
from local_alignment import LocalAlignment
from skeleton import SkeletonModel

model = None
runs = {}
bindings = {}
MAX_RUNS = 32


def drop_run(run_id):
    runs.pop(run_id, None)
    for stream in list(bindings):
        if bindings[stream] == run_id:
            del bindings[stream]


def bind_stream(stream_id, run_id):
    if run_id not in runs:
        raise ValueError("Alignment session missing or expired")
    for stream in list(bindings):
        if bindings[stream] == run_id:
            del bindings[stream]
    bindings[stream_id] = run_id


def dispatch(request):
    global model
    operation = request["operation"]
    if operation == "status":
        if model is None:
            model = SkeletonModel()
        return dict(ready=True, providers=model.providers)
    if operation == "infer":
        if model is None:
            model = SkeletonModel()
        image = cv2.imdecode(np.frombuffer(base64.b64decode(request["image"]), dtype=np.uint8), cv2.IMREAD_COLOR)
        if image is None or image.size > 640 * 640 * 3:
            raise ValueError("Invalid/oversized pose image")
        pose = model.infer(image, request["timestampMs"], request["streamId"])
        pose["streamId"] = request["streamId"]
        bound_run = bindings.get(request["streamId"])
        if bound_run in runs:
            runs[bound_run][1] = time.monotonic()
            pose["alignment"] = dict(runId=bound_run, timestampMs=pose["timestampMs"], result=runs[bound_run][0].update(pose))
        return pose
    run_id = request["runId"]
    if operation == "start":
        now = time.monotonic()
        for key in list(runs):
            if now - runs[key][1] > 600:
                drop_run(key)
        if run_id not in runs:
            if len(runs) >= MAX_RUNS:
                raise ValueError("Too many active alignment sessions")
            runs[run_id] = [LocalAlignment(request["canonical"], request["difficulty"], request["leniency"]), now]
        if request.get("streamId"):
            bind_stream(request["streamId"], run_id)
        return dict(ready=True)
    if operation == "bind":
        bind_stream(request["streamId"], run_id)
        return dict(ready=True)
    if operation == "finish":
        drop_run(run_id)
        return dict(finished=True)
    if operation == "align":
        if run_id not in runs:
            raise ValueError("Alignment session missing or expired")
        runs[run_id][1] = time.monotonic()
        return runs[run_id][0].update(request["pose"])
    raise ValueError("Unknown movement operation")


if __name__ == "__main__":
    for line in sys.stdin:
        request = {}
        try:
            request = json.loads(line)
            result = dict(id=request["id"], result=dispatch(request))
        except Exception as error:
            traceback.print_exc(file=sys.stderr)
            result = dict(id=request.get("id"), error=str(error))
        print(json.dumps(result, allow_nan=False), flush=True)
