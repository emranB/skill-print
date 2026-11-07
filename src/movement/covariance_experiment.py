"""Teacher-only complete-geometry OAS uncertainty experiment. Offline only."""
import json
from pathlib import Path

import numpy as np

from compare_teacher_representations import distribution,trajectory
from motion_features import pack
from segment_experiment import segment
from trajectory_experiment import Cursor,metric,nearest,phases


def transform(v,matrix):
    values,confidence=v
    energy=matrix**2
    variance=(1/np.maximum(confidence.ravel(),1e-3)**2)@energy
    reliability=np.sqrt(np.sum(energy,axis=0)/np.maximum(variance,1e-12))
    return (values.ravel()@matrix).reshape(values.shape),reliability.reshape(values.shape)


def fit(clips):
    weights=np.ones((12,4))
    centered=[[(f,(v[0]-c[0][1][0],v[1])) for f,v in c] for c in clips]
    paths=[phases(c,weights,0) for c in centered]
    residuals=[]
    for i,path in enumerate(paths):
        for phase,p in enumerate(path):
            other=pack([v for j,q in enumerate(paths) if j!=i for _,v in q[phase]])
            # Equal geometric phase samples keep long pauses from dominating covariance.
            arc=np.r_[0,np.cumsum([metric(a[1],b[1],weights) for a,b in zip(p,p[1:])])]
            indices=[int(np.argmin(np.abs(arc-t))) for t in np.linspace(0,arc[-1],31)]
            for k in indices:
                v=p[k][1]
                _,matched=nearest(v,other,weights)
                residuals.append(((v[0]-matched[0])*np.minimum(v[1],matched[1])).ravel())
    residuals=np.array(residuals)
    n,dimension=residuals.shape
    empirical=residuals.T@residuals/n
    # OAS closed-form shrinkage (Chen et al., 2010); no residual mean body is created.
    trace=float(np.trace(empirical));frobenius=float(np.sum(empirical**2))
    denominator=(n+1)*(frobenius-trace**2/dimension)
    shrinkage=min(1.,(frobenius+trace**2)/max(denominator,1e-12))
    covariance=(1-shrinkage)*empirical+shrinkage*trace/dimension*np.eye(dimension)
    eigenvalues,eigenvectors=np.linalg.eigh(covariance)
    eigenvalues=np.maximum(eigenvalues,max(trace/dimension*1e-6,1e-12))
    matrix=(eigenvectors/np.sqrt(eigenvalues)[None,:])@eigenvectors.T
    matrix/=np.sqrt(np.mean(matrix**2)*dimension)
    transformed=[[(f,transform(v,matrix)) for f,v in c] for c in clips]
    centered=[[(f,(v[0]-c[0][1][0],v[1])) for f,v in c] for c in transformed]
    paths=[phases(c,weights,0) for c in centered]
    positive=[];near=[]
    for i,path in enumerate(paths):
        for phase,p in enumerate(path):
            other=pack([v for j,q in enumerate(paths) if j!=i for _,v in q[phase]])
            positive.extend(nearest(v,other,weights)[0] for _,v in p)
        near.extend(metric(a[1],b[1],weights) for a,b in zip(centered[i],centered[i][1:]))
    calibration=dict(weights=weights.tolist(),tolerance=float(np.percentile(positive,95)),noise=float(np.median(near)),
                     positive=distribution(positive),nearby=distribution(near),whitening=matrix.tolist(),shrinkage=shrinkage,
                     covarianceEigenvalues=eigenvalues.tolist(),fullRank=int(np.linalg.matrix_rank(matrix)))
    return calibration


class CovarianceCursor(Cursor):
    def __init__(self,rows,calibration,difficulty=75):
        self.matrix=np.array(calibration['whitening'])
        super().__init__([(f,transform(v,self.matrix)) for f,v in rows],calibration,difficulty)

    def update(self,row):
        return super().update((row[0],transform(row[1],self.matrix)))


def replay(rows,ref,calibration,difficulty=75):
    cursor=CovarianceCursor(ref,calibration,difficulty)
    maximum=0.;scores=[]
    for row in rows:
        complete=cursor.update(row);maximum=max(maximum,cursor.progress);scores.append(cursor.score)
        if complete:break
    return dict(complete=cursor.complete,progress=maximum,phase=cursor.phase,similarity=distribution(scores),reason=cursor.reason)


def main():
    path=Path('test-results/movement/generalization/accepted-baseline/teacher-cycle.json')
    frames=json.loads(path.read_text())['analysis']['poseRecording']['frames']
    segmentation,_=segment(trajectory(frames,'mediapipe-invariant'))
    rows=trajectory(frames,'mediapipe-kinematic-body')
    clips=[[r for r in rows if w['startMs']<=r[0]['timestampMs']<=w['endMs']] for w in segmentation['windows']]
    calibration=fit(clips)
    report=dict(teacherOnly=True,strategy='complete-body-geometry-oas',calibration=calibration,segmentation=segmentation,selfReplay={},matrix=[])
    for difficulty in (20,50,75,80,100):report['selfReplay'][difficulty]=[replay(c,c,calibration,difficulty) for c in clips]
    for i,execution in enumerate(clips):
        frozen=fit([c for j,c in enumerate(clips) if i!=j])
        report['matrix'].append([None if i==j else replay(execution,ref,frozen) for j,ref in enumerate(clips)])
    report['halfDensity']=[replay(c[::2],c,calibration) for c in clips]
    # Each background episode independently resets, rather than concatenating unrelated snippets.
    chunks=[];current=[]
    for row in rows:
        if any(w['startMs']<=row[0]['timestampMs']<=w['endMs'] for w in segmentation['windows']):
            if current:chunks.append(current)
            current=[]
        else:current.append(row)
    if current:chunks.append(current)
    report['background']=[[replay(c,ref,calibration) for ref in clips] for c in chunks]
    Path('test-results/movement/final-generic/covariance-teacher.json').write_text(json.dumps(report,indent=2,default=float))
    print(json.dumps(dict(self75=sum(r['complete'] for r in report['selfReplay'][75]),heldout=sum(any(r and r['complete'] for r in row) for row in report['matrix']),
                          half=sum(r['complete'] for r in report['halfDensity']),background=sum(r['complete'] for chunk in report['background'] for r in chunk),fullRank=calibration['fullRank'])))


if __name__=='__main__':main()
