"""Offline teacher geometry oracle. Not online recognition or learner calibration."""
import hashlib
import json
from pathlib import Path

import numpy as np

from motion_features import distances,features,pack

WINDOWS = [(8067,10533),(13000,16467),(18267,21067),(30733,39133),(42333,46600),(56867,63333)]


def trajectory(frames,strategy):
    rows = [(f,features(f,strategy)) for f in frames]
    return [(f,v) for f,v in rows if v is not None]


def phase_path(rows,strategy):
    x=pack([v for _,v in rows])
    d=distances((x[0][:1],x[1][:1]),x,strategy=="rtmw-3d")[0]
    smoothed=np.array([np.median(d[max(0,i-1):i+2][np.isfinite(d[max(0,i-1):i+2])]) if np.isfinite(d[max(0,i-1):i+2]).any() else 0 for i in range(len(d))])
    apex=int(np.argmax(smoothed))
    indices=[]
    for lo,hi in ((0,apex),(apex,len(rows)-1)):
        if hi<=lo:
            indices += [lo]*31
            continue
        part=(x[0][lo:hi+1],x[1][lo:hi+1])
        steps=np.diag(distances(part,part,strategy=="rtmw-3d"),1)
        steps=np.where(np.isfinite(steps),steps,0)
        arc=np.r_[0,np.cumsum(steps)]
        indices += [lo+int(np.argmin(np.abs(arc-p))) for p in np.linspace(0,arc[-1],31)]
    return (x[0][indices],x[1][indices]),apex


def distribution(values):
    x=np.asarray(values);x=x[np.isfinite(x)]
    return dict(count=len(x),mean=float(np.mean(x)),p50=float(np.median(x)),p05=float(np.percentile(x,5)),p95=float(np.percentile(x,95))) if len(x) else None


def main():
    paths={"rtmw-native":"test-results/movement/3d/roi/lesson-squat-rtmw3d.json",
           "rtmw-browser":"test-results/movement/3d/browser-movement-batched/teacher-cycle.json",
           "mediapipe":"test-results/movement/generalization/accepted-baseline/teacher-cycle.json"}
    report={"teacherOnly":True,"evaluation":"offline ordered geometry oracle, not production acceptance", "inputSha256":{},"experiments":[]}
    for name,path in paths.items():
        raw=Path(path).read_bytes();data=json.loads(raw)
        report["inputSha256"][path]=hashlib.sha256(raw).hexdigest()
        frames=data["frames"] if "frames" in data else data["analysis"]["poseRecording"]["frames"]
        strategies=["mediapipe-xy","mediapipe-world","mediapipe-invariant"] if name=="mediapipe" else ["rtmw-3d","rtmw-xy","rtmw-hybrid","rtmw-invariant"]
        for strategy in strategies:
            clips=[trajectory([f for f in frames if lo<=f["timestampMs"]<=hi],strategy) for lo,hi in WINDOWS]
            paths_phase=[phase_path(c,strategy)[0] if len(c)>=4 else None for c in clips]
            matrix=np.full((6,6),np.inf);coverage=np.zeros((6,6));near=[];far=[];apices=[]
            for i,c in enumerate(clips):
                if not c:continue
                x=pack([v for _,v in c]);d=distances(x,x,strategy=="rtmw-3d")
                near.extend(np.diag(d,1).tolist());far.extend(d[np.abs(np.arange(len(c))[:,None]-np.arange(len(c))[None,:])>len(c)*.35].tolist())
                for j,ref in enumerate(paths_phase):
                    if ref is None:continue
                    errors=distances(paths_phase[i],ref,strategy=="rtmw-3d")
                    aligned=np.diag(errors)
                    matrix[i,j]=float(np.median(aligned[np.isfinite(aligned)])) if np.isfinite(aligned).any() else np.inf
                    # Oracle lets each reference phase look at its corresponding observed half.
                    apex=phase_path(c,strategy)[1];actual=distances(ref,x,strategy=="rtmw-3d")
                    phase_min=np.r_[np.min(actual[:31,:apex+1],axis=1),np.min(actual[31:,apex:],axis=1)]
                    coverage[i,j]=float(np.mean(phase_min<=.3125))
            positives=[matrix[i,j] for i in range(6) for j in range(6) if i!=j]
            row=dict(source=name,strategy=strategy,usable=[len(c) for c in clips],nearby=distribution(near),distant=distribution(far),
                     crossAligned=distribution(positives),crossMedianDistance=np.where(np.isfinite(matrix),matrix,-1).tolist(),
                     oracleCoverageAtOldTolerance=coverage.tolist())
            report["experiments"].append(row)
            print(json.dumps({k:row[k] for k in ("source","strategy","usable","nearby","distant","crossAligned","oracleCoverageAtOldTolerance")}),flush=True)
    out=Path("test-results/movement/final-generic");out.mkdir(parents=True,exist_ok=True)
    (out/"teacher-representations.json").write_text(json.dumps(report,indent=2))


if __name__=="__main__":main()
