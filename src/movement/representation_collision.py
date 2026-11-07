"""A physical-direction counterexample for the reduced diagnostic descriptor."""
import json
from pathlib import Path

import numpy as np

from motion_features import MP,features
from trajectory_experiment import Cursor,metric


def arm_cycle(direction):
    result=[]
    for i,theta in enumerate(np.r_[np.linspace(0,np.pi/2,31),np.linspace(np.pi/2,0,31)[1:]]):
        points=np.array([[-.3,-.6,0],[.3,-.6,0],[-.3,0,0],[-.3,0,0],[.3,0,0],[.3,0,0],[-.2,0,0],[.2,0,0],[-.2,.45,0],[-.2,.9,0],[.2,.45,0],[.2,.9,0]])
        delta=np.array([0,np.cos(theta),direction*np.sin(theta)])
        points[2]=points[0]+.3*delta;points[3]=points[2]+.3*delta
        points[4]=points[1]+.3*delta;points[5]=points[4]+.3*delta
        world=[dict(x=0.,y=0.,z=0.,visibility=1.) for _ in range(33)]
        for index,p in zip(MP,points):
            world[index]=dict(x=float(p[0]),y=float(p[1]),z=float(p[2]),visibility=1.)
        result.append(dict(timestampMs=i*1000/15,worldLandmarks=world,landmarks=world))
    return result


def main():
    forward,backward=arm_cycle(1),arm_cycle(-1)
    report=dict(control='synthetic arms forward versus arms backward; identical inclinations and parent flexions',realVideoClaim=False,comparisons={})
    for strategy in ('mediapipe-invariant','mediapipe-body','mediapipe-gram','mediapipe-kinematic-body'):
        a=[(f,features(f,strategy)) for f in forward];b=[(f,features(f,strategy)) for f in backward]
        weights=np.ones(12)
        errors=[metric(x[1],y[1],weights) for x,y in zip(a,b)]
        report['comparisons'][strategy]=dict(maximumDistance=max(errors),meanDistance=float(np.mean(errors)))
        if strategy=='mediapipe-invariant':
            nearby=[metric(x[1],y[1],weights) for x,y in zip(a,a[1:])]
            cal=dict(weights=weights.tolist(),noise=float(np.median(nearby)),tolerance=float(np.percentile(nearby,95)))
            source=Cursor(a,cal,100);negative=Cursor(a,cal,100)
            for x,y in zip(a,b):source.update(x);negative.update(y)
            report['teacherOnlyCalibration']=cal
            report['sourceCompletes']=source.complete
            report['differentDirectionCompletes']=negative.complete
    Path('test-results/movement/final-generic/representation-collision.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report))


if __name__=='__main__':main()
