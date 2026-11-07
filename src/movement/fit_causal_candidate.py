"""Teacher-only discrimination/quality fit. Never imports learner observations."""
import argparse
import json
from pathlib import Path

import numpy as np

from compare_teacher_representations import trajectory
from evaluate_causal_candidate import run
from segment_experiment import segment
from trajectory_experiment import calibrate,metric,replay


def fit(clips):
    kept=list(range(len(clips)))
    history=[]
    while len(kept)>=2:
        calibration=calibrate([clips[i] for i in kept])
        weights=np.array(calibration['weights'])
        excursions={i:max(metric(clips[i][0][1],v,weights) for _,v in clips[i]) for i in kept}
        # Disjoint start/excursion uncertainty balls are necessary for meaningful ordered evidence.
        accepted=[i for i in kept if excursions[i]>2*calibration['tolerance']]
        history.append(dict(sources=kept,tolerance=calibration['tolerance'],excursions=excursions,accepted=accepted))
        if accepted==kept:
            return kept,calibration,history
        kept=accepted
    return [],None,history


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',default='test-results/movement/generalization/accepted-baseline/teacher-cycle.json')
    parser.add_argument('--strategy',default='mediapipe-invariant')
    parser.add_argument('--name',default='full-invariant-discriminable')
    args=parser.parse_args()
    data=json.loads(Path(args.input).read_text())
    frames=data.get('frames') or data['analysis']['poseRecording']['frames']
    segmentation,_=segment(trajectory(frames,'mediapipe-invariant'))
    rows=trajectory(frames,args.strategy)
    clips=[[r for r in rows if w['startMs']<=r[0]['timestampMs']<=w['endMs']] for w in segmentation['windows']]
    kept,calibration,history=fit(clips)
    report=dict(teacherOnly=True,input=args.input,strategy=args.strategy,segmentation=segmentation,eligible=kept,calibration=calibration,qualityHistory=history,matrix=[],selfReplay={},resampling={},continuousTeacher=None)
    if calibration:
        refs=[clips[i] for i in kept]
        for difficulty in (20,50,75,80,100):
            report['selfReplay'][difficulty]=[replay(c,c,calibration,difficulty) for c in refs]
        for i,execution in enumerate(clips):
            training=[c for j,c in enumerate(clips) if j!=i]
            train_kept,frozen,train_history=fit(training)
            ids=[j for j in range(len(clips)) if j!=i]
            selected={ids[k] for k in train_kept}
            row=[None if i==j else replay(execution,c,frozen) if frozen and j in selected else dict(complete=False,progress=0,reason='training_reference_not_discriminable') for j,c in enumerate(clips)]
            report['matrix'].append(dict(heldout=i,trainingEligible=sorted(selected),calibration=frozen,qualityHistory=train_history,results=row))
        report['continuousTeacher']=run(rows,refs,calibration,75)
        for density in (.5,1,2):
            results=[]
            for ref in refs:
                execution=ref[::2] if density==.5 else ref
                if density==2:
                    execution=[]
                    for a,b in zip(ref,ref[1:]):
                        execution.extend([a,({'timestampMs':(a[0]['timestampMs']+b[0]['timestampMs'])/2},((a[1][0]+b[1][0])/2,np.minimum(a[1][1],b[1][1])))])
                    execution.append(ref[-1])
                results.append(replay(execution,ref,calibration,75))
            report['resampling'][str(density)]=results
        report['resampling']['drops']=[replay([r for i,r in enumerate(ref) if i%7!=3],ref,calibration,75) for ref in refs]
        # Separate continuous teacher-background chunks; never splice disjoint snippets.
        chunks=[];current=[]
        for r in rows:
            if any(w['startMs']<=r[0]['timestampMs']<=w['endMs'] for w in segmentation['windows']):
                if current:chunks.append(current)
                current=[]
            else:current.append(r)
        if current:chunks.append(current)
        report['teacherBackground']=[run(c,refs,calibration,75) for c in chunks]
    output=Path(f'test-results/movement/final-generic/fitted-{args.name}.json')
    output.write_text(json.dumps(report,indent=2,default=float))
    print(json.dumps(dict(name=args.name,proposals=len(clips),eligible=kept,tolerance=calibration and calibration['tolerance'],self75=sum(x['complete'] for x in report['selfReplay'].get(75,[])),
                          heldout=sum(any(x and x['complete'] for x in row['results']) for row in report['matrix']),teacherReps=report['continuousTeacher'] and len(report['continuousTeacher']['events']),
                          resampling={k:sum(x['complete'] for x in rows) for k,rows in report['resampling'].items()},backgroundReps=sum(len(r['events']) for r in report.get('teacherBackground',[])))))


if __name__=='__main__':main()
