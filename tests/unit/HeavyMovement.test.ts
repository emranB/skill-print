import { describe,it,expect } from "vitest";
import { heavyBody, HEAVY_REPRESENTATION, rawFeatureDistance, usableHeavy } from "../../src/shared/movement/HeavyBody";
import { featureDistance, oas, transform } from "../../src/shared/movement/OAS";
import { buildHeavyMovement, fitTeacherCalibration } from "../../src/frontend/lesson/HeavyReferenceBuilder";
import { HeavyProgressTracker } from "../../src/frontend/learn/HeavyProgressTracker";
import type { Demonstration, Landmark, NormalizedPose } from "../../src/frontend/pose/pose.types";
import { teacherCalibrationSchema } from "../../src/shared/movement/heavySchema";
import { LessonSchema, NormalizedPoseGeometrySchema } from "../../src/frontend/lesson/LessonSchema";
import { ghostLandmarks } from "../../src/frontend/learn/ghostPose";
import { largestDeviation } from "../../src/frontend/learn/PoseDeviation";

function points(t:number,direction=1):Landmark[] {
  const p=Array.from({length:33},() => ({x:0,y:0,z:0,visibility:1}));
  const major:Record<number,number[]>={11:[-.25,-.6,0],12:[.25,-.6,0],13:[-.4,-.3,direction*t*.55],
    14:[.4,-.3,0],15:[-.5,-.1,direction*t],16:[.5,-.1,0],23:[-.18,0,0],24:[.18,0,0],
    25:[-.18,.5,0],26:[.18,.5,0],27:[-.18,1,0],28:[.18,1,0]};
  for(const [i,v] of Object.entries(major)) p[Number(i)]={x:v[0]!,y:v[1]!,z:v[2]!,visibility:1};
  return p;
}
function pose(t:number,i:number,direction=1):NormalizedPose {return {timestampMs:i*67,landmarks:points(t,direction),body3d:heavyBody(points(t,direction))!};}
function demo(direction=1,id="teacher",sequence=false):Demonstration {
  const trajectory=Array.from({length:61},(_,i) => pose(sequence ? i/60 : Math.sin(Math.PI*i/60),i,direction));
  return {id,kind:sequence ? "sequence" : "cycle",startMs:0,endMs:4020,classification:"good",teacherConfirmed:true,trajectory};
}
function replay(rows:NormalizedPose[],movement=buildHeavyMovement([demo()],"cycle"),difficulty=75) {
  const tracker=new HeavyProgressTracker(movement,difficulty);
  const events=rows.map(p => tracker.update(p)).filter(e => e?.type==="REP_SUCCESS" || e?.type==="SEQUENCE_COMPLETE");
  return {events,tracker};
}

describe("Heavy complete directional geometry and teacher-only OAS",() => {
  it("preserves all 48 directional/flexion features and distinguishes the old forward/back collision",() => {
    const forward=heavyBody(points(.8))!,back=heavyBody(points(.8,-1))!;
    expect(forward.features).toHaveLength(48);expect(rawFeatureDistance(forward,back)).toBeGreaterThan(.1);
    expect(forward.features).not.toEqual(back.features);
    expect(replay(demo(-1).trajectory).events).toHaveLength(0);
  });
  it("is invariant to translation, scale and yaw without exchanging left/right",() => {
    const source=points(.7),original=heavyBody(source)!;
    const changed=source.map(p => ({...p,x:2*(p.x*Math.cos(.8)+p.z*Math.sin(.8))+3,y:p.y*2+2,z:2*(-p.x*Math.sin(.8)+p.z*Math.cos(.8))+4}));
    const normalized=heavyBody(changed)!;
    expect(rawFeatureDistance(original,normalized)).toBeLessThan(1e-12);
    expect(normalized.joints[0]![0]).toBeLessThan(normalized.joints[1]![0]);
    const swapped=source.map(p => ({...p}));[swapped[15],swapped[16]]=[swapped[16]!,swapped[15]!];
    expect(rawFeatureDistance(original,heavyBody(swapped)!)).toBeGreaterThan(.1);
  });
  it("masks missing/extremity confidence instead of inventing zero geometry",() => {
    const p=points(.5);p[15]!.visibility=0;
    const b=heavyBody(p)!;
    expect(b.joints[4]).toBeNull();expect(b.bones[3]).toBeNull();expect(b.features[12]).toBeNull();expect(b.featureConfidence[12]).toBe(0);
    expect(usableHeavy(b)).toBe(true);
    const cal=fitTeacherCalibration([demo()]);expect(transform(b,cal).values.every(Number.isFinite)).toBe(true);
  });
  it("fits deterministic finite regularized OAS including small/singular datasets",() => {
    const cal=fitTeacherCalibration([demo()]);expect(cal).toEqual(fitTeacherCalibration([demo()]));
    expect(teacherCalibrationSchema.safeParse(cal).success).toBe(true);
    for(const input of [[],[Array<number>(48).fill(1)],Array.from({length:3},() => Array<number>(48).fill(0))]) {
      const fitted=oas(input);expect(fitted.whitening.flat().every(Number.isFinite)).toBe(true);
      expect(fitted.covariance.every((r,i) => r[i]!>0)).toBe(true);
    }
    const feature=transform(demo().trajectory[0]!.body3d!,cal);expect(featureDistance(feature,feature)).toBe(0);
  });
  it("rejects unconfirmed/learner calibration inputs and preserves observed source metadata",() => {
    expect(() => fitTeacherCalibration([{...demo(),teacherConfirmed:false}])).toThrow(/teacher/);
    const movement=buildHeavyMovement([demo()],"cycle");
    const before=JSON.stringify(movement.statisticalCalibration);replay(demo(-1).trajectory,movement);
    expect(JSON.stringify(movement.statisticalCalibration)).toBe(before);expect(movement.representation).toBe(HEAVY_REPRESENTATION);
    expect(movement.anchors!.map(a => a.id)).toEqual(["start","completion"]);
    expect(movement.anchors!.every(a => a.holdMs===0)).toBe(true);
    expect(NormalizedPoseGeometrySchema.parse(movement.samples![0]!.pose).body3d).toBeDefined();
    for(const sample of movement.samples!) expect(demo().trajectory.some(p => JSON.stringify(p)===JSON.stringify(sample.pose))).toBe(true);
  });
  it("whitens covariance to a scaled identity without dropping dimensions",() => {
    const cal=oas(Array.from({length:60},(_,i) => Array.from({length:48},(_,j) => Math.sin(i*.37+j*.13)+Math.cos(i*j*.11))));
    const product=cal.whitening.map(row => cal.whitening.map(other => row.reduce((sum,w,i) =>
      sum+w*cal.covariance[i]!.reduce((s,c,j) => s+c*other[j]!,0),0)));
    const diagonal=product[0]![0]!;
    expect(diagonal).toBeGreaterThan(0);
    product.forEach((row,i) => row.forEach((v,j) => expect(v).toBeCloseTo(i===j ? diagonal : 0,10)));
  });
  it("rejects mixed versioned geometry and round-trips Heavy source timestamps",() => {
    const canonicalMovement=buildHeavyMovement([demo()],"cycle");
    const lesson={schemaVersion:1,id:"heavy-schema",name:"Test",createdAt:"now",updatedAt:"now",teacherCalibration:{},
      referencePose:demo().trajectory[0],demonstrations:[demo()],canonicalMovement,knowledge:[],guardrails:[],
      trackingProfile:{requiredLandmarks:[],requiredFeatures:[]},sourceSessionId:"teacher"};
    const parsed=LessonSchema.parse(lesson);
    expect(parsed.canonicalMovement.references![0]!.samples.map(s => s.pose.timestampMs)).toEqual(canonicalMovement.samples!.map(s => s.pose.timestampMs));
    for(const incompatible of [{...canonicalMovement,schemaVersion:2},{...canonicalMovement,representation:"rtmw3d-body-v1"}])
      expect(LessonSchema.safeParse({...lesson,canonicalMovement:incompatible}).success).toBe(false);
  });
  it("masks missing ghost joints and suppresses unreliable directional coaching",() => {
    const p=points(.5);p[15]!.visibility=0;
    const body=heavyBody(p)!;
    const ghost=ghostLandmarks({pose:pose(.8,0)},p,.5,body)!;
    expect(ghost[15]!.visibility).toBe(0);
    expect(ghost[11]!.visibility).toBe(1);
    expect(ghost.filter(j => j.visibility!>0).every(j => Number.isFinite(j.x)&&Number.isFinite(j.y))).toBe(true);
    const unreliable={...body,orientationReliable:false};
    expect(largestDeviation({landmarks:p,body3d:unreliable},pose(.8,0),.5)).toBeNull();
    expect(largestDeviation(pose(-.8,0),pose(.8,0),.5)?.direction).toMatch(/forward|back/);
  });
});

describe("production Heavy causal local aligner",() => {
  it.each([20,50,75,80,100])("self replays once at difficulty %s",difficulty => {
    const result=replay(demo().trajectory,undefined,difficulty);
    expect(result.events,JSON.stringify(result.tracker.diagnostics())).toHaveLength(1);expect(result.tracker.diagnostics().furthestProgressPercent).toBe(100);
  });
  it.each(["half","double","drops","slow","fast"])("handles generic temporal %s",mode => {
    let rows=demo().trajectory;
    if(mode==="half") rows=rows.filter((_,i) => i%2===0);
    if(mode==="double") rows=rows.flatMap(p => [p,{...p,timestampMs:p.timestampMs+30}]);
    if(mode==="drops") rows=rows.filter((_,i) => i%7!==3);
    if(mode==="slow") rows=rows.map(p => ({...p,timestampMs:p.timestampMs*2}));
    if(mode==="fast") rows=rows.map(p => ({...p,timestampMs:p.timestampMs/2}));
    expect(replay(rows).events).toHaveLength(1);
  });
  it("rejects static, start/end skips, partial and disconnected observations",() => {
    const rows=demo().trajectory;
    for(const input of [rows.map(p => ({...rows[0]!,timestampMs:p.timestampMs})),[rows[0]!,rows.at(-1)!],rows.slice(0,30),
      [rows[0]!,{...rows[30]!,timestampMs:3000},rows.at(-1)!]]) expect(replay(input).events).toHaveLength(0);
  });
  it("sequence completes once, rejects reverse, and never wraps",() => {
    const d=demo(1,"sequence",true),movement=buildHeavyMovement([d],"sequence");
    expect(replay([...d.trajectory,...d.trajectory.map(p => ({...p,timestampMs:p.timestampMs+5000}))],movement).events).toHaveLength(1);
    expect(replay([...d.trajectory].reverse().map((p,i) => ({...p,timestampMs:i*67})),movement).events).toHaveLength(0);
  });
  it("rejects reversal of an asymmetric cycle without requiring an apex",() => {
    const d=demo();
    d.trajectory=Array.from({length:101},(_,i) => {
      const angle=i/100*2*Math.PI,p=points(0);
      p[15]!.z=Math.sin(angle)*.7;p[15]!.y+=.5*(1-Math.cos(angle));
      return {timestampMs:i*67,landmarks:p,body3d:heavyBody(p)!};
    });
    const movement=buildHeavyMovement([d],"cycle");
    expect(replay(d.trajectory,movement).events).toHaveLength(1);
    expect(replay([...d.trajectory].reverse().map((p,i) => ({...p,timestampMs:i*67})),movement).events).toHaveLength(0);
  });
  it("does not borrow phases from other independent references",() => {
    const a=demo(1,"a"),b=demo(-1,"b");const movement=buildHeavyMovement([a,b],"cycle");
    // Freeze A's calibration so this test isolates candidate state, not broad teacher variation.
    movement.statisticalCalibration=fitTeacherCalibration([a]);
    const rows=[...a.trajectory.slice(0,30),...b.trajectory.slice(30)];
    const result=replay(rows,movement);expect(result.events).toHaveLength(0);
    expect(result.tracker.candidates).toHaveLength(2);
  });
  it("emits one event per cycle, then awaits start; explicit holds require observed time",() => {
    const rows=demo().trajectory,movement=buildHeavyMovement([demo()],"cycle");
    expect(replay([...rows,...rows.map(p => ({...p,timestampMs:p.timestampMs+5000}))],movement).events).toHaveLength(2);
    movement.references![0]!.anchors[0]!.holdMs=150;movement.references![0]!.anchors[0]!.holdSource="teacher_requested";
    expect(replay(rows,movement).events).toHaveLength(0);
  });
});
