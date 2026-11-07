import { describe, expect, it } from "vitest";
import { inspectTeacherMotion } from "../../src/frontend/analyze/TeacherMotionEvidence";
import { buildReferenceMovement, buildTeacherReference } from "../../src/frontend/lesson/ReferenceMovementBuilder";
import { LessonSchema } from "../../src/frontend/lesson/LessonSchema";
import { compileLesson } from "../../src/frontend/lesson/LessonCompiler";
import { captureBodyCalibration } from "../../src/frontend/calibration/BodyCalibration";
import { syntheticReferenceFrame } from "../../src/frontend/teach/syntheticPose";
import type { Demonstration, NormalizedPose } from "../../src/frontend/pose/pose.types";
import type { BodySkeleton } from "../../src/shared/movement/types";

function pose(angle: number, timestampMs: number): NormalizedPose {
  const bodySkeleton: BodySkeleton = { representation: "rtmw3d-body-v1", checkpoint:"synthetic",
    bones:Array.from({length:12},()=>[Math.sin(angle),Math.cos(angle),0]), boneConfidence:Array(12).fill(1),
    joints:Array.from({length:12},()=>[0,0,0]),confidence:Array(12).fill(1),depthConfidence:[],orientationReliable:true,
    root:[0,0,0],scale:1,basis:[[1,0,0],[0,1,0],[0,0,1]],cameraAssumption:"synthetic" };
  return { timestampMs,landmarks:[],bodySkeleton };
}
const demo = (values = [0,0,.15,.3,.45,.6,.6,.45,.3,.15,0,0]): Demonstration => ({
  id:"synthetic",kind:"cycle",startMs:0,endMs:(values.length - 1)*100,teacherConfirmed:true,classification:"good",
  trajectory: values.map((v,i)=>pose(v,i*100)),apexMs:1,
});

describe("observed teacher anchor regions",()=> {
  it("infers reversal geometry without an annotated apex or elapsed percentages",()=> {
    const a = demo();
    const ref = buildTeacherReference(a,"cycle");
    const b = { ...a,apexMs:999999,trajectory:a.trajectory.map((p,i)=>({...p,timestampMs:i*80+i*i})) };
    expect(ref.alignmentEligible).toBe(true);
    expect(buildTeacherReference({...a,apexMs:undefined},"cycle").samples).toEqual(ref.samples);
    expect(buildTeacherReference(b,"cycle").anchors.map((a)=>a.pose.bodySkeleton)).toEqual(ref.anchors.map((a)=>a.pose.bodySkeleton));
    expect(ref.anchors[1]!.pose.bodySkeleton!.bones[0]![0]).toBeCloseTo(Math.sin(.6));
  });
  it("observability does not require the teacher to dwell for the learner hold",()=> {
    const d = demo();
    const ref = buildTeacherReference(d,"cycle");
    expect(ref.alignmentEligible).toBe(true);
    expect(ref.anchors.every((a)=>a.holdMs===0 && a.holdSource===undefined)).toBe(true);
    expect(ref.anchors.every((a)=>a.region!.endMs-a.region!.startMs===100)).toBe(true);
    expect(ref.anchors.every((a)=>a.region!.samples.every((p)=>d.trajectory.includes(p)))).toBe(true);
  });
  it("rejects isolated nominal anchors and retains rejected evidence",()=> {
    const d = demo([0,.15,.3,.45,.6,.45,.3,.15,0]);
    const ref = buildTeacherReference(d,"cycle");
    expect(ref.alignmentEligible).toBe(false);
    expect(ref.rejectionReason).toMatch(/region/);
    expect(ref.sourceTrajectory).toBe(d.trajectory);
    expect(ref.quality!.regions.start!.samples).toHaveLength(1);
  });
  it("retains a short coherent confidence gap without inventing samples",()=> {
    const d=demo(); d.trajectory[3]!.bodySkeleton!.orientationReliable=false;
    const e=inspectTeacherMotion(d.trajectory,"cycle");
    expect(e.quality.gaps[0]).toMatchObject({missingSamples:1,durationMs:200,coherent:true});
    expect(e.reliable).toHaveLength(d.trajectory.length-1);
    expect(e.reliable.some((r)=>r.pose===d.trajectory[3])).toBe(false);
  });
  it("rejects long/ambiguous gaps and incomparable reliable bone masks",()=> {
    const long=demo();long.trajectory=long.trajectory.map((p,i)=>({...p,timestampMs:p.timestampMs+(i>=4?2000:0)}));
    expect(buildTeacherReference(long,"cycle").rejectionReason).toMatch(/continuity/);
    const masks=demo(); masks.trajectory[3]!.bodySkeleton!.boneConfidence=[0,0,0,0,0,0,1,1,1,1,1,1];
    masks.trajectory[2]!.bodySkeleton!.boneConfidence=[1,1,1,1,1,1,0,0,0,0,0,0];
    expect(buildTeacherReference(masks,"cycle").rejectionReason).toMatch(/common reliable/);
  });
  it("sequence endpoints need not return and never acquire an apex",()=> {
    const canonical=buildReferenceMovement([demo([0,0,.15,.3,.45,.6,.6])],"sequence");
    expect(canonical.anchors!.map((a)=>a.id)).toEqual(["start","completion"]);
    expect(canonical.samples!.every((s)=>s.phase==="sequence")).toBe(true);
  });
  it("round trips region metadata but rejects manufactured region geometry",()=> {
    const d=demo();
    const lesson=compileLesson({name:"Synthetic",sourceSessionId:"synthetic",teacherCalibration:captureBodyCalibration(syntheticReferenceFrame()),
      referencePose:d.trajectory[0]!,demonstrations:[d],questions:[]});
    expect(LessonSchema.parse(JSON.parse(JSON.stringify(lesson))).canonicalMovement.references![0]!.quality).toEqual(lesson.canonicalMovement.references![0]!.quality);
    const corrupt=JSON.parse(JSON.stringify(lesson)) as typeof lesson;
    corrupt.canonicalMovement.references![0]!.anchors[0]!.region!.samples[0]!.bodySkeleton!.bones[0]![0]=.9;
    expect(LessonSchema.safeParse(corrupt).success).toBe(false);
    const point=structuredClone(lesson);
    for (const ref of point.canonicalMovement.references!) {
      delete ref.anchorConstruction; delete ref.quality;
      for (const a of ref.anchors) delete a.region;
    }
    expect(LessonSchema.safeParse(point).success).toBe(true);
  });
});
