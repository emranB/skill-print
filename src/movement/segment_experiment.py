"""Unlabelled rest/recurrence segmentation experiment on coherent source geometry."""
import json
from pathlib import Path

import numpy as np

from compare_teacher_representations import WINDOWS, trajectory
from motion_features import distances, pack
from trajectory_experiment import metric


def segment(rows, weights=None):
    x = pack([v for _,v in rows])
    # A positive floor retains every bone, but adjacent-frame noise cannot dominate rest detection.
    if weights is None:
        times=np.array([f['timestampMs'] for f,_ in rows])
        next_indices=np.minimum(np.searchsorted(times,times+200),len(rows)-1)
        noise = np.median(np.sum((x[0][next_indices]-x[0])**2,axis=2),axis=0)
        signal = np.mean(np.var(x[0],axis=0),axis=1)
        weights = signal/np.maximum(noise,np.median(noise)*.1)
        weights = np.maximum(weights/np.max(weights),.2)
    flat=(x[0]*np.sqrt(weights)[None,:,None]).reshape(len(rows),-1)
    centered=flat-flat.mean(axis=0)
    _,singular,axes=np.linalg.svd(centered,full_matrices=False)
    projected=centered@axes[0]
    # A recording-derived recurrent motion coordinate, never a joint/action label.
    d=np.abs(projected[:,None]-projected[None,:])
    cadence = np.median(np.diff([f['timestampMs'] for f,_ in rows]))
    radius = float(np.percentile(d,10))
    times = np.array([f['timestampMs'] for f,_ in rows])
    time_weights = np.minimum(np.r_[np.diff(times),cadence],cadence*3)
    density = (d<=radius) @ time_weights
    rest = int(np.argmax(density))
    excursion = np.abs(projected-projected[rest])
    smooth = np.array([np.median(excursion[np.abs(times-t)<=150]) for t in times])
    baseline = float(np.percentile(smooth,20))
    amplitude = float(np.percentile(smooth,95))-baseline
    enter, leave = baseline+.2*amplitude,baseline+.1*amplitude
    start = None
    peak = 0.
    last_rest = 0
    output = []
    for i,value in enumerate(smooth):
        if i and times[i]-times[i-1]>1000:
            start = None
        if start is None:
            if value>enter:
                start=last_rest
                peak=value
            elif value<=leave:
                last_rest=i
        else:
            peak=max(peak,value)
            if value<=leave:
                if peak-baseline>=max(2*np.percentile(np.abs(np.diff(smooth)),90),amplitude*.2) and start>0:
                    output.append((start,i))
                start=None
                last_rest=i
    return dict(restMs=times[rest],radius=radius,baseline=baseline,amplitude=amplitude,enter=enter,leave=leave,weights=weights.tolist(),latentVariance=float(singular[0]**2/np.sum(singular**2)),
                windows=[dict(startMs=times[a],endMs=times[b],samples=b-a+1,
                              annotationIoU=[max(0,min(times[b],hi)-max(times[a],lo))/max(1,max(times[b],hi)-min(times[a],lo)) for lo,hi in WINDOWS]) for a,b in output]), [rows[a:b+1] for a,b in output]


def main():
    data=json.loads(Path('test-results/movement/generalization/accepted-baseline/teacher-cycle.json').read_text())
    rows=trajectory(data['analysis']['poseRecording']['frames'],'mediapipe-invariant')
    report={}
    for name,part in [('full',rows),('half',rows[::2]),('drops',[r for i,r in enumerate(rows) if i%7!=3])]:
        result,clips=segment(part)
        report[name]=result
    Path('test-results/movement/final-generic/segmentation-v4-fixed-lag.json').write_text(json.dumps(report,indent=2,default=float))
    print(json.dumps(report,default=float))


if __name__=='__main__':main()
