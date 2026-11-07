import { afterEach, describe, expect, it, vi } from "vitest";
import { buildCanonicalMovement } from "../../src/frontend/lesson/CanonicalMovementBuilder";
import { buildRuntimeTargets, resolveCanonical } from "../../src/frontend/lesson/RuntimeTargets";
import { LessonSchema } from "../../src/frontend/lesson/LessonSchema";
import { compileLesson } from "../../src/frontend/lesson/LessonCompiler";
import { captureBodyCalibration } from "../../src/frontend/calibration/BodyCalibration";
import { LearningRun } from "../../src/frontend/learn/LearningRun";
import { DebugBus } from "../../src/frontend/debug/DebugBus";
import { RuntimeConfigManager } from "../../src/frontend/config/RuntimeConfig";
import { syntheticReferenceFrame } from "../../src/frontend/teach/syntheticPose";
import { normalizePose } from "../../src/frontend/pose/PoseNormalizer";
import { largestDeviation } from "../../src/frontend/learn/PoseDeviation";
import { ghostLandmarks } from "../../src/frontend/learn/ghostPose";
import type { BodySkeleton, Vector3 } from "../../src/shared/movement/types";
import type { Demonstration } from "../../src/frontend/pose/pose.types";
import type { MovementAlignmentReply } from "../../src/frontend/pose/pose.types";

const skeleton = (angle: number): BodySkeleton => ({ representation: "rtmw3d-body-v1", checkpoint: "synthetic-unit-test-not-model-output",
  joints: Array.from({ length: 12 }, (_, i): Vector3 => [i / 12, -1, angle]), confidence: Array(12).fill(1),
  bones: Array.from({ length: 12 }, (): Vector3 => [Math.sin(angle), Math.cos(angle), 0]), boneConfidence: Array(12).fill(1),
  depthConfidence: [], orientationReliable: true, root: [0,0,5], scale: 1, basis: [[1,0,0],[0,1,0],[0,0,1]],
  cameraAssumption: "synthetic", imageSize: [640,360] });
const frame = (angle: number, timestampMs: number) => ({ ...syntheticReferenceFrame(), timestampMs, bodySkeleton: skeleton(angle) });
const demo = (id = "first"): Demonstration => ({ id, kind: "cycle", startMs: 0, apexMs: 500, endMs: 1000,
  classification: "good", teacherConfirmed: true, trajectory: [0,0,.15,.3,.45,.6,.6,.45,.3,.15,0,0].map((angle, i) => normalizePose(frame(angle, i * 100))) });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); DebugBus.clear(); });

describe("3D production integration", () => {
  it("retains complete sources without averaging and without relabeling legacy", () => {
    const a = demo(), b = demo("second");
    b.trajectory[3]!.bodySkeleton = skeleton(.35);
    const canonical = buildCanonicalMovement([a,b]);
    expect(canonical.schemaVersion).toBe(3);
    expect(canonical.references).toHaveLength(2);
    expect(canonical.references![0]!.sourceTrajectory).toBe(a.trajectory);
    expect(canonical.references![1]!.samples[3]!.pose.bodySkeleton).toBe(b.trajectory[3]!.bodySkeleton);
    expect(resolveCanonical(canonical)).toBe(canonical);
    expect(buildCanonicalMovement([{ ...a, trajectory: a.trajectory.map(({ landmarks, timestampMs }) => ({ landmarks, timestampMs })) }]).schemaVersion).toBe(2);
  });
  it("requires confirmation and rejects mixed legacy/3D references", () => {
    expect(() => buildCanonicalMovement([{ ...demo(), teacherConfirmed: false }])).toThrow(/Confirm/);
    const mixed = demo(); delete mixed.trajectory[2]!.bodySkeleton;
    expect(() => buildCanonicalMovement([mixed])).toThrow(/relabeled/);
  });
  it("previews unclassified uploads and retains rejected reference evidence", () => {
    const unknown = { ...demo(), teacherConfirmed: false, classification: "unknown" as const };
    const draft = buildCanonicalMovement([unknown],"cycle",true);
    expect(draft.references![0]!.teacherConfirmed).toBe(false);
    expect(draft.checkpoints).toHaveLength(9);
    const unreliable = demo("unreliable");
    unreliable.trajectory.slice(0,5).forEach((p) => { p.bodySkeleton!.orientationReliable = false; });
    const canonical = buildCanonicalMovement([demo(),unreliable]);
    expect(canonical.references).toHaveLength(2);
    expect(canonical.references![1]!.alignmentEligible).toBe(false);
    expect(canonical.references![1]!.sourceTrajectory).toBe(unreliable.trajectory);
  });
  it("difficulty changes density without geometry tolerance or target synthesis", () => {
    const canonical = buildCanonicalMovement([demo()]);
    expect([1,20,50,75,80,99,100].map((d) => buildRuntimeTargets(canonical,d).length)).toEqual([5,5,5,9,11,201,201]);
    expect(buildRuntimeTargets(canonical,100).every((t) => canonical.samples!.some((s) => s.pose === t.pose))).toBe(true);
  });
  it("round-trips persisted 3D and sequence semantics", () => {
    const sequence = { ...demo(), kind: "sequence" as const, apexMs: undefined };
    const calibration = captureBodyCalibration(frame(0,0));
    const lesson = compileLesson({ kind: "sequence", name: "Test", sourceSessionId: "test", teacherCalibration: calibration,
      referencePose: calibration.neutralPose, demonstrations: [sequence], questions: [] });
    const restored = LessonSchema.parse(JSON.parse(JSON.stringify(lesson)));
    expect(restored.canonicalMovement.references![0]!.sourceTrajectory[0]!.bodySkeleton).toEqual(skeleton(0));
    expect(restored.canonicalMovement.anchors!.map((a) => a.id)).toEqual(["start","completion"]);
    expect(restored.canonicalMovement.samples!.every((s) => s.phase === "sequence")).toBe(true);
    const corrupted = structuredClone(lesson); delete corrupted.canonicalMovement.references![0]!.sourceTrajectory[0]!.bodySkeleton;
    expect(LessonSchema.safeParse(corrupted).success).toBe(false);
    const unconfirmed = structuredClone(lesson);
    Reflect.deleteProperty(unconfirmed.canonicalMovement.references![0]!, "teacherConfirmed");
    expect(LessonSchema.safeParse(unconfirmed).success).toBe(false);
  });
  it("awaits pending 3D alignment before one idempotent EOF evaluation", async () => {
    const calibration = captureBodyCalibration(frame(0,0));
    const lesson = compileLesson({ name: "Test", sourceSessionId: "test", teacherCalibration: calibration,
      referencePose: calibration.neutralPose, demonstrations: [demo()], questions: [] });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options: { body: string }) => {
      const request = JSON.parse(options.body); calls.push(request.operation);
      if (request.operation !== "align") return new Response("{}");
      await Promise.resolve();
      return new Response(JSON.stringify({ event: request.pose.timestampMs === 67 ? "REP_SUCCESS" : null,
        referenceId: "first", similarity: 1, alignmentMethod: "local_trajectory", localDistance: 0, normalizedDtwDistance: null, currentProgressPercent: 100,
        furthestProgressPercent: 100, currentPhase: "return", lastSatisfiedAnchor: "completion", runtimeTargetCount: 9,
        runtimeTargetIndex: 8, reason: "anchor_satisfied", alignedSample: lesson.canonicalMovement.samples!.at(-1), usable: true, alignmentMs: 1 }));
    }));
    const run = new LearningRun(lesson, RuntimeConfigManager.get(), "upload");
    void run.processFrame(frame(0,0)); void run.processFrame(frame(0,67));
    const first = await run.finishAsync("eof");
    expect(first.reps).toBe(1); expect(first.frames).toBe(2);
    expect(run.tracker.constructor.name).toBe("LocalProgressTracker");
    expect(run.tracker.diagnostics()).toMatchObject({ alignmentMethod: "local_trajectory", localDistance: 0, normalizedDtwDistance: null });
    expect(await run.finishAsync("eof")).toBe(first);
    expect(DebugBus.getEvents().filter((e) => e.event === "LEARN_EVALUATION_COMPLETE")).toHaveLength(1);
    expect(calls.filter((s) => s === "align")).toHaveLength(2);
  });
  it("coaches reliable body-relative depth and projects the ghost in the learner orientation", () => {
    const target = normalizePose(frame(0,0)), student = normalizePose(frame(0,67));
    student.bodySkeleton!.joints[0]![2] = .5;
    expect(largestDeviation(student,target,.65)?.direction).toBe("back");
    student.bodySkeleton!.confidence[0] = 0;
    expect(largestDeviation(student,target,.65)).toBeNull();
    expect(ghostLandmarks({pose:target}, frame(0,0).landmarks,.65,student.bodySkeleton)![11]!.y).toBeLessThan(.5);
  });
  it("consumes matching batched alignment once and rejects stale run/timestamp metadata", async () => {
    const calibration = captureBodyCalibration(frame(0,0));
    const lesson = compileLesson({ name: "Test", sourceSessionId: "test", teacherCalibration: calibration,
      referencePose: calibration.neutralPose, demonstrations: [demo()], questions: [] });
    const reply: MovementAlignmentReply = { event: null, referenceId: "first", similarity: 1, alignmentMethod: "local_trajectory", localDistance: 0, normalizedDtwDistance: null,
      currentProgressPercent: 0, furthestProgressPercent: 0, currentPhase: "outbound", lastSatisfiedAnchor: null,
      runtimeTargetCount: 9, runtimeTargetIndex: 0, reason: "awaiting_start", alignedSample: lesson.canonicalMovement.samples![0]!, usable: true, alignmentMs: 1 };
    const operations: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_url, options: { body: string }) => {
      const request = JSON.parse(options.body); operations.push(request.operation);
      return new Response(JSON.stringify(request.operation === "align" ? reply : {}));
    }));
    const run = new LearningRun(lesson,RuntimeConfigManager.get(),"upload");
    const streamId = "2e029e86-441c-4570-987c-63c03548599e";
    await run.processFrame({ ...frame(0,0), streamId });
    await run.processFrame({ ...frame(0,67), streamId, alignment: { runId: run.runId, timestampMs: 67, result: { ...reply, event: "REP_SUCCESS" } } });
    expect(operations.filter((o) => o === "align")).toHaveLength(1);
    await run.processFrame({ ...frame(0,134), streamId, alignment: { runId: "stale", timestampMs: 67, result: { ...reply, event: "REP_SUCCESS" } } });
    expect(operations.filter((o) => o === "align")).toHaveLength(2);
    expect((await run.finishAsync("eof")).reps).toBe(1);
  });
});
