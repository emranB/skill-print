import { usableHeavy } from "../../shared/movement/HeavyBody";
import { featureDistance, interpolateFeature, projectFeature, transform, type Feature, type TeacherCalibration3D } from "../../shared/movement/OAS";
import { buildRuntimeTargets, type RuntimeTarget } from "../lesson/RuntimeTargets";
import type { CanonicalMovement, MovementReference, NormalizedPose } from "../pose/pose.types";
import type { ProgressTrackerEvent } from "./ProgressTracker";

class LocalCandidate {
  position=0;
  maximum=0;
  started=false;
  previous: Feature | null=null;
  lastMs: number | null=null;
  supportedMs=0;
  reach=0;
  reason="awaiting_start";
  distance=Infinity;
  restarts=0;
  holdStart: number | null=null;
  readonly features: Feature[];
  readonly targets: RuntimeTarget[];

  constructor(readonly reference: MovementReference,readonly cal: TeacherCalibration3D,canonical: CanonicalMovement,difficulty:number) {
    this.features=reference.samples.map(s => transform(s.pose.body3d!,cal));
    this.targets=buildRuntimeTargets({...canonical,samples:reference.samples,anchors:reference.anchors},difficulty);
  }
  reset(reason:string) {
    this.position=0;this.started=false;this.previous=null;this.reach=0;this.holdStart=null;
    this.reason=reason;this.restarts++;
  }
  at(position:number): Feature {
    const samples=this.reference.samples;
    const upper=samples.findIndex(s => s.progress01>=position-1e-9);
    if(upper<=0) return this.features[upper<0 ? this.features.length-1 : 0]!;
    const a=samples[upper-1]!,b=samples[upper]!;
    return interpolateFeature(this.features[upper-1]!,this.features[upper]!,
      (position-a.progress01)/Math.max(1e-9,b.progress01-a.progress01));
  }
  hold(id:"start"|"completion",timestamp:number,compatible:boolean) {
    const anchor=this.reference.anchors.find(a => a.id===id);
    const requested=anchor?.holdSource==="teacher_requested" ? anchor.holdMs : 0;
    if(!compatible) {this.holdStart=null;return false;}
    this.holdStart ??= timestamp;
    return timestamp-this.holdStart>=requested;
  }
  update(pose:NormalizedPose):boolean {
    const timestamp=pose.timestampMs;
    if(this.lastMs!==null && (timestamp<=this.lastMs || timestamp-this.lastMs>1000)) this.reset("tracking_gap_restart");
    this.lastMs=timestamp;
    if(!usableHeavy(pose.body3d)) {
      this.reason="tracking_invalid";
      if(this.started && timestamp-this.supportedMs>1000) this.reset("tracking_loss_restart");
      return false;
    }
    const v=transform(pose.body3d,this.cal);
    const tolerance=this.cal.tolerance;
    if(!this.started) {
      this.distance=featureDistance(v,this.features[0]!);
      if(this.hold("start",timestamp,this.distance<=tolerance)) {
        this.started=true;this.previous=v;this.supportedMs=timestamp;this.holdStart=null;this.reason="start_compatible";
      }
      return false;
    }
    const previous=this.previous!;
    const observedStep=featureDistance(previous,v);
    if(observedStep>this.reference.trajectoryEvidence!.arcLength*.25+this.reference.trajectoryEvidence!.noise*2) {
      this.reset("disconnected_observation_restart");return false;
    }
    const upper=Math.min(1,this.position+.25);
    const candidates:Array<{distance:number;position:number;segment:number}>=[];
    const samples=this.reference.samples;
    for(let i=0;i<samples.length-1;i++) {
      const a=samples[i]!.progress01,b=samples[i+1]!.progress01;
      if(b<this.position || a>upper) continue;
      const projection=projectFeature(v,this.features[i]!,this.features[i+1]!);
      const position=Math.max(this.position,Math.min(upper,a+projection.fraction*(b-a)));
      candidates.push({position,distance:featureDistance(v,this.at(position)),segment:i});
    }
    candidates.sort((a,b) => a.distance-b.distance || a.position-b.position);
    this.distance=candidates[0]?.distance ?? Infinity;
    this.reason="local_mismatch";
    for(const candidate of candidates) {
      if(candidate.distance>tolerance) break;
      if(candidate.position<=this.position+1e-9 || observedStep<=Math.max(this.cal.noise*.02,1e-8)) continue;
      if((candidate.position-this.position)*this.reference.trajectoryEvidence!.arcLength>observedStep+2*tolerance) continue;
      const tangentA=this.features[candidate.segment]!,tangentB=this.features[candidate.segment+1]!;
      const tangent=tangentA.values.reduce((sum,x,i) => sum+(tangentB.values[i]!-x)*(v.values[i]!-previous.values[i]!)*
        Math.min(tangentA.confidence[i]!,tangentB.confidence[i]!,v.confidence[i]!,previous.confidence[i]!)**2,0);
      if(tangent<=0 && observedStep>2*this.reference.trajectoryEvidence!.noise) continue;
      // Crossing is supported by the observed transition, not time, FPS or a target budget.
      const crossed=this.targets.filter(t => t.progress01>this.position && t.progress01<=candidate.position);
      if(crossed.some(t => projectFeature(this.at(t.progress01),previous,v).distance>tolerance)) continue;
      if(samples.some(s => s.progress01>this.position && s.progress01<candidate.position && projectFeature(this.at(s.progress01),previous,v).distance>tolerance)) continue;
      const from=this.at(this.position),to=this.at(candidate.position);
      let direction=0;
      from.values.forEach((x,i) => {direction+=(to.values[i]!-x)*(v.values[i]!-previous.values[i]!)*Math.min(from.confidence[i]!,to.confidence[i]!,v.confidence[i]!,previous.confidence[i]!)**2;});
      if(direction<=0 && observedStep>2*this.reference.trajectoryEvidence!.noise) continue;
      this.position=candidate.position;this.distance=candidate.distance;this.supportedMs=timestamp;this.reason="ordered_transition";
      break;
    }
    this.reach=Math.max(this.reach,this.reason==="ordered_transition" ? featureDistance(v,this.features[0]!) : 0);
    const endpoint=featureDistance(v,this.features.at(-1)!);
    // A sparse observation may support the terminal tail without visiting its exact final frame.
    const tailSupported=this.position>=.9 && this.reference.samples.filter(s => s.progress01>this.position)
      .every(s => projectFeature(this.at(s.progress01),previous,v).distance<=tolerance);
    const terminalCompatible=endpoint<=tolerance;
    const complete=this.reason==="ordered_transition" && (this.position>=1-1e-8 || tailSupported && terminalCompatible);
    this.previous=v;
    if(complete && this.hold("completion",timestamp,endpoint<=tolerance)) {
      this.position=1;this.maximum=1;this.distance=endpoint;this.reason="ordered_completion";return true;
    }
    // Explicit terminal holds remain causal even when the terminal observation stops moving.
    if(this.position>=1-1e-8 && this.hold("completion",timestamp,endpoint<=tolerance)) {
      this.maximum=1;this.reason="ordered_completion";return true;
    }
    this.maximum=Math.max(this.maximum,this.position);
    if(timestamp-this.supportedMs>1000 && featureDistance(v,this.at(this.position))>tolerance) this.reset("unsupported_episode_restart");
    return false;
  }
}

/** New browser production core. Each coherent teacher source owns its entire causal state. */
export class HeavyProgressTracker {
  readonly candidates: LocalCandidate[];
  readonly targets: RuntimeTarget[];
  private active:LocalCandidate;
  private completed=false;
  private closed=false;
  private furthest=0;
  private alignmentMs=0;
  private completionReference:string | undefined;
  lastSimilarity=0;
  constructor(readonly canonical:CanonicalMovement,difficulty=75) {
    if(canonical.representation!=="mediapipe-heavy-body3d-v1" || !canonical.statisticalCalibration) throw new Error("Heavy alignment requires teacher calibration");
    this.candidates=canonical.references!.filter(r => r.teacherConfirmed && r.alignmentEligible)
      .map(r => new LocalCandidate(r,canonical.statisticalCalibration!,canonical,difficulty));
    if(!this.candidates.length) throw new Error("No eligible Heavy reference");
    this.active=this.candidates[0]!;this.targets=[...this.active.targets];
  }
  update(pose:NormalizedPose):ProgressTrackerEvent | null {
    if(this.closed || this.completed) return null;
    if(pose.bodySkeleton || pose.body3d && pose.body3d.representation!==this.canonical.representation) throw new Error("Incompatible learner representation");
    const started=performance.now();
    let success:LocalCandidate | undefined;
    const before=this.active.position;
    for(const candidate of this.candidates) if(candidate.update(pose)) success ??= candidate;
    this.active=success ?? [...this.candidates].sort((a,b) => b.position-a.position || a.distance-b.distance)[0]!;
    this.furthest=Math.max(this.furthest,...this.candidates.map(c => c.maximum*100));
    this.lastSimilarity=Math.max(0,1-this.active.distance/Math.max(this.active.cal.tolerance,1e-9));
    this.targets.splice(0,this.targets.length,...this.active.targets);
    this.alignmentMs=performance.now()-started;
    if(success) {
      this.completionReference=success.reference.demonstrationId;
      if(this.canonical.kind==="sequence") this.completed=true;
      else this.candidates.forEach(c => c.reset("cycle_reset"));
      return {type:this.canonical.kind==="sequence" ? "SEQUENCE_COMPLETE" : "REP_SUCCESS"};
    }
    if(this.active.position>before) return {type:"CHECKPOINT_PASSED",index:this.getExpectedIndex(),progress:this.active.position*100,phase:"sequence"};
    return {type:"MISMATCH",index:this.getExpectedIndex(),similarity:this.lastSimilarity};
  }
  getExpectedIndex() {return Math.max(0,this.targets.findIndex(t => t.progress01>=this.active.position-1e-8));}
  getGhostTarget() {
    return this.active.reference.samples.reduce((a,b) => Math.abs(a.progress01-this.active.position)<=Math.abs(b.progress01-this.active.position) ? a : b);
  }
  diagnostics() {
    return {furthestProgressPercent:this.furthest,currentProgressPercent:this.active.position*100,currentPhase:"sequence",
      referenceId:this.active.reference.demonstrationId,completionReferenceId:this.completionReference,
      lastSatisfiedAnchor:this.completed ? "completion" : this.active.started ? "start" : null,
      runtimeTargetIndex:this.getExpectedIndex(),runtimeTargetCount:this.targets.length,reason:this.active.reason,
      localDistance:Number.isFinite(this.active.distance) ? this.active.distance : null,normalizedDtwDistance:null,
      alignmentMethod:"local_trajectory",alignmentMs:this.alignmentMs,
      candidates:this.candidates.map(c => ({referenceId:c.reference.demonstrationId,progress:c.position*100,maximum:c.maximum*100,reason:c.reason,restarts:c.restarts}))};
  }
  finish() {this.closed=true;return this.completed ? "sequence_complete" : this.furthest>0 ? "incomplete_trajectory" : "awaiting_start";}
}
