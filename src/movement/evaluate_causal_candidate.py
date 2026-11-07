"""Frozen teacher calibration; empirical candidate evaluation, never production claims."""
import argparse
import hashlib
import json
import time
from pathlib import Path

import numpy as np

from compare_teacher_representations import distribution, trajectory
from trajectory_experiment import Cursor, replay

ROOT=Path('test-results/movement/final-generic')
ATTEMPTS=[('front-1',9000,14000),('front-2',14000,18000),('side-1',23000,28000),('side-2',28000,33000)]


def run(rows,refs,calibration,difficulty,kind='cycle'):
    cursors=[Cursor(r,calibration,difficulty,kind) for r in refs]
    maximum=0.
    events=[]
    trace=[]
    timings=[]
    for frame,v in rows:
        start=time.perf_counter()
        completed=[i for i,c in enumerate(cursors) if c.update((frame,v))]
        best=max(enumerate(cursors),key=lambda pair:(pair[1].progress,pair[1].score))
        maximum=max(maximum,best[1].progress)
        trace.append(dict(timestampMs=frame['timestampMs'],progress=best[1].progress,reference=best[0],phase=best[1].phase,similarity=best[1].score))
        timings.append((time.perf_counter()-start)*1000)
        if completed:
            events.append(dict(timestampMs=frame['timestampMs'],reference=completed[0],event='REP_SUCCESS' if kind=='cycle' else 'SEQUENCE_COMPLETE'))
            if kind=='sequence':break
            for c in cursors:
                offset=c.offset
                c.reset()
                c.offset=offset
    return dict(events=events,maximumProgress=maximum,trace=trace,matchingMs=distribution(timings))


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--frozen',default='causal-teacher-v5-relative.json')
    parser.add_argument('--name',default='candidate-v5-evaluation')
    args=parser.parse_args()
    path=ROOT/args.frozen
    frozen=json.loads(path.read_text())
    teacher_path=Path('test-results/movement/generalization/accepted-baseline/teacher-cycle.json')
    teacher=json.loads(teacher_path.read_text())['analysis']['poseRecording']['frames']
    rows=trajectory(teacher,'mediapipe-invariant')
    refs=[[r for r in rows if w['startMs']<=r[0]['timestampMs']<=w['endMs']] for w in frozen['segmentation']['windows']]
    if 'eligible' in frozen:refs=[refs[i] for i in frozen['eligible']]
    cal=frozen['calibration']
    student_path=Path('test-results/movement/generalization/accepted-baseline/position-75.json')
    student=trajectory(json.loads(student_path.read_text())['frames'],'mediapipe-invariant')
    report=dict(status='DIAGNOSTIC_ONLY',teacherCalibrationSha256=hashlib.sha256(path.read_bytes()).hexdigest(),
                teacherInputSha256=hashlib.sha256(teacher_path.read_bytes()).hexdigest(),studentInputSha256=hashlib.sha256(student_path.read_bytes()).hexdigest(),
                calibration=cal,selfResampling={},learnerAttempts={},continuous={},negatives={},limitations=['Not production streaming; inference caches replayed','Invariant inclination/flexion descriptor loses azimuth','Original annotations contain grouped subcycles'])
    for density in (.5,1,2):
        results=[]
        for ref in refs:
            if density==.5:execution=ref[::2]
            elif density==1:execution=ref
            else:
                execution=[]
                for a,b in zip(ref,ref[1:]):
                    execution.extend([a,({'timestampMs':(a[0]['timestampMs']+b[0]['timestampMs'])/2},((a[1][0]+b[1][0])/2,np.minimum(a[1][1],b[1][1])))])
                execution.append(ref[-1])
            results.append(replay(execution,ref,cal,75))
        report['selfResampling'][str(density)]=results
    report['selfResampling']['drops']=[replay([r for i,r in enumerate(ref) if i%7!=3],ref,cal,75) for ref in refs]
    for difficulty in (20,50,75,80,100):
        report['learnerAttempts'][difficulty]={name:run([r for r in student if lo<=r[0]['timestampMs']<=hi],refs,cal,difficulty) for name,lo,hi in ATTEMPTS}
        report['continuous'][difficulty]=run(student,refs,cal,difficulty)
        report['negatives'][difficulty]={name:run([r for r in student if lo<=r[0]['timestampMs']<hi],refs,cal,difficulty) for name,lo,hi in [('setup-walking',0,9000),('turn-standing',18000,23000),('exit',33000,40000)]}
        report['negatives'][difficulty]['static-start']=run([(dict(timestampMs=i*67),refs[0][0][1]) for i in range(100)],refs,cal,difficulty)
        report['negatives'][difficulty]['outbound-only']=[run(ref[:max(2,len(ref)//3)], [ref],cal,difficulty) for ref in refs]
    dance_path=Path('test-results/movement/generalization/accepted-baseline/teacher-sequence.json')
    dance=trajectory(json.loads(dance_path.read_text())['analysis']['poseRecording']['frames'],'mediapipe-invariant')
    # A single source supplies no cross-source uncertainty estimate: nearby source variation only.
    from trajectory_experiment import metric
    weights=np.ones(12)
    near=[metric(a[1],b[1],weights) for a,b in zip(dance,dance[1:])]
    dance_cal=dict(weights=weights.tolist(),noise=float(np.median(near)),tolerance=float(np.percentile(near,95)))
    report['dance']=dict(calibration=dance_cal,teacherSourceCount=1,selfReplay={d:run(dance,[dance],dance_cal,d,'sequence') for d in (20,50,75,80,100)},reversed=run([(dict(timestampMs=i*67),v) for i,(_,v) in enumerate(reversed(dance))],[dance],dance_cal,75,'sequence'),learnerValidation=False)
    (ROOT/f'{args.name}.json').write_text(json.dumps(report,indent=2,default=float))
    print(json.dumps(dict(resampling={k:sum(r['complete'] for r in rs) for k,rs in report['selfResampling'].items()},
                          attempts={d:{n:[len(r['events']),round(r['maximumProgress']*100,1)] for n,r in attempts.items()} for d,attempts in report['learnerAttempts'].items()},
                          continuous={d:len(r['events']) for d,r in report['continuous'].items()},
                          negatives={d:{n:len(r['events']) if isinstance(r,dict) else sum(len(x['events']) for x in r) for n,r in ns.items()} for d,ns in report['negatives'].items()},
                          dance={d:len(r['events']) for d,r in report['dance']['selfReplay'].items()},reversedDance=len(report['dance']['reversed']['events']))))


if __name__=='__main__':main()
