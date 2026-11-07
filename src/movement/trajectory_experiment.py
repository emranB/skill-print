"""Teacher-only causal prototype. Deliberately separate from production selection."""
import argparse
import json
from pathlib import Path

import numpy as np

from compare_teacher_representations import WINDOWS, distribution, trajectory
from motion_features import distances, pack


def metric(a, b, weights):
    w=metric_weights(a[1],b[1],weights)
    return float(np.sqrt(np.sum(w*(a[0]-b[0])**2)/max(np.sum(w),1e-9)))


def metric_weights(a,b,weights):
    w=np.minimum(a,b)**2
    if w.ndim==1:
        # Unit-vector distance retains its historical sum over coordinates.
        return w[:,None]*weights[:,None]
    return w*(weights if weights.ndim==2 else weights[:,None])


def nearest(v, other, weights):
    values,confidence=other
    w=np.minimum(v[1][None,:],confidence)**2
    if w.ndim==2:
        w=w[:,:,None]*weights[None,:,None]
    else:w=w*(weights[None,:,:] if weights.ndim==2 else weights[None,:,None])
    errors=np.sqrt(np.sum(w*(values-v[0][None,:,:])**2,axis=(1,2))/np.maximum(np.sum(w,axis=(1,2)),1e-9))
    index=int(np.argmin(errors))
    return float(errors[index]),(values[index],confidence[index])


def segment_error(target, a, b, weights):
    w = metric_weights(target[1],np.minimum(a[1],b[1]),weights)
    delta = b[0]-a[0]
    offset = target[0]-a[0]
    fraction = np.clip(np.sum(w*offset*delta)/max(np.sum(w*delta*delta), 1e-12), 0, 1)
    return float(np.sqrt(np.sum(w*(offset-fraction*delta)**2)/max(np.sum(w), 1e-9)))


def simplify(rows, weights, epsilon):
    if len(rows) <= 2 or epsilon<=0:
        return rows
    errors = [segment_error(r[1], rows[0][1], rows[-1][1], weights) for r in rows]
    i = int(np.argmax(errors))
    if errors[i] <= epsilon:
        return [rows[0], rows[-1]]
    return simplify(rows[:i+1], weights, epsilon)[:-1]+simplify(rows[i:], weights, epsilon)


def phases(rows, weights, noise):
    d = np.array([metric(rows[0][1], v, weights) for _, v in rows])
    smooth = [np.median(d[max(0, i-1):i+2]) for i in range(len(d))]
    apex = int(np.argmax(smooth))
    return [simplify(rows[:apex+1], weights, noise), simplify(rows[apex:], weights, noise)]


def calibrate(clips):
    """No execution under evaluation may be supplied here (including noise estimation)."""
    clips=[[(f,(v[0]-c[0][1][0],v[1])) for f,v in c] for c in clips]
    component_weighted=clips[0][0][1][1].ndim==2
    initial = np.ones(clips[0][0][1][0].shape if component_weighted else 12)
    noise = [metric(a[1], b[1], initial) for c in clips for a, b in zip(c, c[1:])]
    paths = [phases(c, initial, 0) for c in clips]
    errors = []
    for i, path in enumerate(paths):
        for phase,p in enumerate(path):
            others=pack([r[1] for j,other in enumerate(paths) if i!=j for r in other[phase]])
            for _,v in p:
                chosen=nearest(v,others,initial)[1]
                errors.append((v[0]-chosen[0])**2 if component_weighted else np.sum((v[0]-chosen[0])**2,axis=1))
    scatter = np.median(errors, axis=0)
    signal = np.median([np.var(pack([v for _,v in c])[0],axis=0) if component_weighted else np.mean(np.var(pack([v for _,v in c])[0],axis=0),axis=1) for c in clips],axis=0)
    weights = signal/np.maximum(scatter, np.median(scatter)*.1)
    if component_weighted:
        # Each bone retains a positive vote; unreliable depth channels do not receive
        # the same mandatory vote as a reliable flexion/inclination measurement.
        ridge=max(float(np.mean(weights))/sum(len(c) for c in clips),1e-9)
        channels=(weights+ridge)/np.sum(weights+ridge,axis=1,keepdims=True)
        bone_strength=np.max(weights,axis=1)
        bone_strength=np.maximum(bone_strength/max(float(np.max(bone_strength)),1e-9),.2)
        weights=channels*bone_strength[:,None]
    else:
        weights = np.maximum(weights/np.max(weights), .2)
    positive = []
    per_source=[]
    for i, c in enumerate(clips):
        p = phases(c, weights, 0)
        others=[phases(other,weights,0) for j,other in enumerate(clips) if i!=j]
        source_positive=[]
        for phase,pp in enumerate(p):
            qq=pack([r[1] for other in others for r in other[phase]])
            source_positive += [nearest(v,qq,weights)[0] for _,v in pp]
        positive+=source_positive
        per_source.append(float(np.percentile(source_positive,95)))
    return dict(weights=weights.tolist(), tolerance=float(np.median(per_source)),sourceP95=per_source,
                noise=float(np.median(noise)), signal=signal.tolist(), scatter=scatter.tolist(), nearby=distribution(noise), positive=distribution(positive))


class Cursor:
    def __init__(self, rows, calibration, difficulty=75, kind='cycle'):
        self.weights = np.array(calibration['weights'])
        self.tolerance = calibration['tolerance']
        self.noise = calibration['noise']
        self.paths = phases(rows, self.weights, self.noise) if kind=='cycle' else [simplify(rows,self.weights,self.noise)]
        self.difficulty = difficulty
        self.reset()

    def reset(self):
        self.phase = -1
        self.position = 0.
        self.progress = 0.
        self.previous = self.origin = None
        self.reach = 0.
        self.complete = False
        self.last = None
        self.score = 0.
        self.reason = 'awaiting_start'
        self.phase_origin = None
        self.offset=None
        self.last_supported=None

    def update(self, row):
        frame, v = row
        timestamp = frame['timestampMs']
        if self.last is not None and timestamp-self.last > 1000:
            self.reset()
        self.last = timestamp
        if self.complete:
            return True
        if self.offset is None:
            self.offset=v[0]-self.paths[0][0][1][0]
        v=(v[0]-self.offset,v[1])
        if self.phase < 0:
            error = metric(v, self.paths[0][0][1], self.weights)
            self.score = max(0, 1-error/max(self.tolerance, 1e-9))
            if error <= self.tolerance:
                self.phase = 0
                self.previous = self.origin = v
                self.phase_origin=self.paths[0][0][1]
                self.last_supported=timestamp
            return False
        path = self.paths[self.phase]
        points = [r[1] for r in path]
        steps = [metric(a, b, self.weights) for a, b in zip(points, points[1:])]
        arc = np.r_[0, np.cumsum(steps)]
        if arc[-1] < 1e-9:
            self.reason = 'no_motion'
            return False
        arc /= arc[-1]
        upper = min(1., self.position+.25)
        candidates = []
        for i in range(len(points)-1):
            if arc[i+1] < self.position or arc[i] > upper:
                continue
            a, b = points[i], points[i+1]
            w = metric_weights(v[1],np.minimum(a[1],b[1]),self.weights)
            delta, offset = b[0]-a[0], v[0]-a[0]
            f = np.clip(np.sum(w*offset*delta)/max(np.sum(w*delta*delta), 1e-12), 0, 1)
            position = float(np.clip(arc[i]+f*(arc[i+1]-arc[i]), self.position, upper))
            f = (position-arc[i])/max(arc[i+1]-arc[i], 1e-9)
            projected = (a[0]+f*delta, np.minimum(a[1], b[1]))
            error = metric(v, projected, self.weights)
            candidates.append((error, position))
        candidates.sort()
        for error, position in candidates:
            if error > self.tolerance:
                continue
            # Density checks the observed segment, not an exact input frame visit.
            targets = np.linspace(self.position, position, max(2, int(self.difficulty*(position-self.position))+1))
            supported = True
            for target in targets:
                i = min(len(points)-2, max(0, int(np.searchsorted(arc, target, side='right')-1)))
                f = (target-arc[i])/max(arc[i+1]-arc[i], 1e-9)
                sample = (points[i][0]+f*(points[i+1][0]-points[i][0]), np.minimum(points[i][1], points[i+1][1]))
                if segment_error(sample, self.previous, v, self.weights) > self.tolerance:
                    supported = False
                    break
            if supported:
                self.position = position
                self.reason = 'ordered_segment'
                self.last_supported=timestamp
                break
        else:
            error = candidates[0][0] if candidates else float('inf')
            self.reason = 'local_mismatch'
            if self.last_supported is not None and timestamp-self.last_supported>1000:
                self.reset()
                self.reason='unsupported_episode_restart'
                return False
        self.score = max(0, 1-error/max(self.tolerance, 1e-9))
        if self.reason=='ordered_segment':
            self.reach = max(self.reach, metric(self.phase_origin, v, self.weights))
        excursion = max(metric(points[0], p, self.weights) for p in points)
        endpoint = metric(v, points[-1], self.weights)
        remaining=[p for p,t in zip(points,arc) if t>=self.position]
        end_supported=all(segment_error(p,self.previous,v,self.weights)<=self.tolerance for p in remaining)
        # The landmark must be locally optimal, not merely inside a broad acceptance ball.
        if self.reason=='ordered_segment' and self.position >= .75 and self.reach >= .8*excursion and endpoint <= min(self.tolerance,error+self.noise) and end_supported:
            self.phase += 1
            self.position = 0.
            self.origin = v
            self.phase_origin=points[-1]
            self.reach = 0.
            if self.phase == len(self.paths):
                self.complete = True
        self.progress = 1. if self.complete else (self.phase+self.position)/len(self.paths)
        self.previous = v
        return self.complete


def replay(rows, ref, calibration, difficulty=75):
    cursor = Cursor(ref, calibration, difficulty)
    maximum = 0.
    scores = []
    for row in rows:
        if cursor.update(row):
            break
        maximum = max(maximum, cursor.progress)
        scores.append(cursor.score)
    return dict(complete=cursor.complete, progress=max(maximum, cursor.progress), phase=cursor.phase,
                reason=cursor.reason, similarity=distribution(scores))


def main():
    from segment_experiment import segment
    parser=argparse.ArgumentParser()
    parser.add_argument('--input',default='test-results/movement/generalization/accepted-baseline/teacher-cycle.json')
    parser.add_argument('--strategy',default='mediapipe-invariant')
    parser.add_argument('--name',default='v6-relative')
    args=parser.parse_args()
    raw = json.loads(Path(args.input).read_text())
    frames = raw.get('frames') or raw['analysis']['poseRecording']['frames']
    all_rows=trajectory(frames,args.strategy)
    segmentation,_=segment(trajectory(frames,'mediapipe-invariant'))
    clips=[[r for r in all_rows if w['startMs']<=r[0]['timestampMs']<=w['endMs']] for w in segmentation['windows']]
    clips=[c for c in clips if len(c)>=3 and c[0][0]['timestampMs']>0]
    matrix = []
    calibration = calibrate(clips)
    windows=segmentation['windows']
    negatives = trajectory([f for f in frames if not any(w['startMs'] <= f['timestampMs'] <= w['endMs'] for w in windows)], args.strategy)
    report = dict(teacherOnly=True,input=args.input,strategy=args.strategy,calibration=calibration, segmentation=segmentation, selfReplay={}, matrix=matrix,
                  negativeDefinition='outside automatically detected cycles; may include missed physical motion; not an independently labelled negative')
    for difficulty in (20,50,75,80,100):
        report['selfReplay'][difficulty] = [replay(c,c,calibration,difficulty) for c in clips]
    for i, execution in enumerate(clips):
        frozen = calibrate([c for j,c in enumerate(clips) if i != j])
        matrix.append([None if i==j else replay(execution, ref, frozen) for j,ref in enumerate(clips)])
    report['negatives'] = [replay(negatives, ref, calibration) for ref in clips]
    out = Path(f'test-results/movement/final-generic/causal-teacher-{args.name}.json')
    out.write_text(json.dumps(report,indent=2,default=float))
    print(json.dumps(dict(name=args.name,clips=len(clips),tolerance=calibration['tolerance'], selfReplay={k:sum(r['complete'] for r in rows) for k,rows in report['selfReplay'].items()},
                          pairs=sum(r is not None and r['complete'] for row in matrix for r in row),heldout=sum(any(r and r['complete'] for r in row) for row in matrix),negatives=sum(r['complete'] for r in report['negatives'])),default=float))


if __name__ == '__main__':
    main()
