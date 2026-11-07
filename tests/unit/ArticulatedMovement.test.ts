import { describe, it, expect } from "vitest";
import {
  articulatedBody,
  articulatedDistance,
  ARTICULATED_REPRESENTATION,
  ARTICULATED_TOLERANCE,
  ARTICULATED_CONFIDENCE,
  usableArticulated,
} from "../../src/shared/movement/ArticulatedBody";
import { buildArticulatedMovement } from "../../src/frontend/lesson/ArticulatedReferenceBuilder";
import { ArticulatedProgressTracker } from "../../src/frontend/learn/ArticulatedProgressTracker";
import { scoreCompletedMovement } from "../../src/frontend/learn/CompletedMovementScorer";
import type { Demonstration, Landmark, NormalizedPose } from "../../src/frontend/pose/pose.types";
import { singleArticulatedExecution } from "../../src/frontend/analyze/ArticulatedTeaching";
import { LessonSchema } from "../../src/frontend/lesson/LessonSchema";
import { buildRuntimeTargets } from "../../src/frontend/lesson/RuntimeTargets";
import { CoachingSession } from "../../src/frontend/learn/CoachingSession";
import { MockApprenticeGateway } from "../../src/frontend/apprentice/MockApprenticeGateway";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";
import {
  MAX_TRAJECTORY_TARGETS,
  difficultyToTargetCount,
  selectArticulatedTargets,
} from "../../src/frontend/lesson/ArticulatedTargets";

function points(t: number, direction = 1): Landmark[] {
  const rows = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 }));
  const body: Record<number, number[]> = {
    11: [-0.25, -0.6, 0],
    12: [0.25, -0.6, 0],
    13: [-0.4, -0.3, direction * t * 0.55],
    14: [0.4, -0.3, 0],
    15: [-0.5, -0.1, direction * t],
    16: [0.5, -0.1, 0],
    23: [-0.18, 0, 0],
    24: [0.18, 0, 0],
    25: [-0.18, 0.5, 0],
    26: [0.18, 0.5, 0],
    27: [-0.18, 1, 0],
    28: [0.18, 1, 0],
  };
  for (const [i, v] of Object.entries(body))
    rows[Number(i)] = { x: v[0]!, y: v[1]!, z: v[2]!, visibility: 1 };
  return rows;
}
function demo(sequence = false, direction = 1, id = "teacher"): Demonstration {
  const trajectory = Array.from({ length: 61 }, (_, i) => {
    const landmarks = points(sequence ? i / 60 : Math.sin((Math.PI * i) / 60), direction);
    return { timestampMs: i * 67, landmarks, articulated3d: articulatedBody(landmarks)! };
  });
  return {
    id,
    kind: sequence ? "sequence" : "cycle",
    startMs: 0,
    endMs: 4020,
    classification: "good",
    teacherConfirmed: true,
    trajectory,
  };
}
function replay(
  path: NormalizedPose[],
  movement = buildArticulatedMovement([demo()], "cycle"),
  difficulty = 75,
) {
  const tracker = new ArticulatedProgressTracker(movement, difficulty);
  const events = path
    .map((p) => tracker.update(p))
    .filter((e) => e?.type === "REP_SUCCESS" || e?.type === "SEQUENCE_COMPLETE");
  return { events, tracker };
}

describe("simple articulated 3D representation", () => {
  it("uses neutral movement wording for unlabelled articulated cycle coaching", () => {
    const source = demo();
    const lesson = {
      id: "coaching",
      canonicalMovement: buildArticulatedMovement([source], "cycle"),
    } as Lesson;
    const session = new CoachingSession(
      new MockApprenticeGateway(),
      { mismatchPersistenceMs: 500, minimumPromptIntervalMs: 2500 },
      lesson,
      null,
      0.5,
    );
    const pose = source.trajectory[0]!;
    const event = { type: "MISMATCH" as const, index: 0, similarity: 0.3 };
    session.handleTrackerEvent(0, event, pose);
    expect(session.handleTrackerEvent(600, event, pose)).toBe(
      "Match the teacher's movement shape.",
    );
  });
  it("retains 11 unit directional bones and 8 bends with rigid translation/scale/rotation invariance", () => {
    const p = points(0.8),
      a = articulatedBody(p)!;
    const transformed = p.map((v) => ({
      ...v,
      x: 3 + 2 * (v.x * Math.cos(0.8) + v.z * Math.sin(0.8)),
      y: 2 * v.y - 1,
      z: 4 + 2 * (-v.x * Math.sin(0.8) + v.z * Math.cos(0.8)),
    }));
    const b = articulatedBody(transformed)!;
    expect(a.bones).toHaveLength(11);
    expect(a.bends).toHaveLength(8);
    expect(a.bones.every((v) => Math.abs(Math.hypot(...v!) - 1) < 1e-10)).toBe(true);
    expect(articulatedDistance(a, b).worst).toBeLessThan(1e-7);
    expect(a.joints[0]![0]).toBeLessThan(a.joints[1]![0]);
    expect(articulatedDistance(a, articulatedBody(points(0.8, -1))!).worst).toBeGreaterThan(0.25);
  });
  it("opposite directional movement fails completed matching and natural rep replay", () => {
    const a = demo(),
      b = demo(false, -1);
    expect(
      scoreCompletedMovement(
        b.trajectory,
        a.trajectory.map((p) => p.articulated3d!),
      ).distance,
    ).toBeGreaterThan(0.25);
    expect(replay(b.trajectory).events).toHaveLength(0);
    expect(
      articulatedDistance(
        a.trajectory[0]!.articulated3d!,
        a.trajectory[30]!.articulated3d!,
      ).bends.some((v) => v !== null && v > 0),
    ).toBe(true);
  });
  it("missing wrist is null, not movement/matching; degenerate bones never become zero vectors", () => {
    const p = points(0.4);
    p[15]!.visibility = 0;
    const b = articulatedBody(p)!;
    expect(b.bones[2]).toBeNull();
    expect(b.boneConfidence[2]).toBe(0);
    expect(usableArticulated(b)).toBe(true);
    const q = points(0.4);
    q[15] = { ...q[13]! };
    expect(articulatedBody(q)!.bones[2]).toBeNull();
    expect(articulatedDistance(b, articulatedBody(points(0.4))!).commonBones).toBe(10);
  });
  it("one confirmed execution compiles without segmentation, covariance, apex or dwell and round-trips", () => {
    const d = demo(),
      movement = buildArticulatedMovement([d], "cycle");
    expect(movement.representation).toBe(ARTICULATED_REPRESENTATION);
    expect(movement.statisticalCalibration).toBeUndefined();
    expect(movement.anchors!.map((a) => a.id)).toEqual(["start", "completion"]);
    expect(movement.anchors!.every((a) => a.holdMs === 0)).toBe(true);
    const frames = d.trajectory.map((p) => ({ ...p, worldLandmarks: p.landmarks }));
    expect(singleArticulatedExecution(frames, "cycle")).toHaveLength(1);
    const lesson = {
      schemaVersion: 1,
      id: "articulated",
      name: "test",
      createdAt: "now",
      updatedAt: "now",
      teacherCalibration: {},
      referencePose: d.trajectory[0],
      demonstrations: [d],
      canonicalMovement: movement,
      knowledge: [],
      guardrails: [],
      trackingProfile: { requiredLandmarks: [], requiredFeatures: [] },
      sourceSessionId: "teacher",
    };
    expect(LessonSchema.safeParse(lesson).success).toBe(true);
    expect(
      LessonSchema.safeParse({
        ...lesson,
        canonicalMovement: { ...movement, representation: "mediapipe-heavy-body3d-v1" },
      }).success,
    ).toBe(false);
    expect(() => buildArticulatedMovement([{ ...d, teacherConfirmed: false }], "cycle")).toThrow();
  });
});
describe("causal ordered completion and aligned quality", () => {
  it("difficulty changes only density, preserving geometry, acceptance and explicit holds", () => {
    const source = demo(true),
      movement = buildArticulatedMovement([source], "sequence");
    movement.references![0]!.anchors[0]!.holdMs = 200;
    const before = JSON.stringify(movement);
    const counts: number[] = [];
    for (const difficulty of [1, 20, 50, 75, 80, 99, 100]) {
      const targets = buildRuntimeTargets(movement, difficulty);
      counts.push(targets.length);
      expect(targets.find((t) => t.anchor?.id === "start")?.anchor?.holdMs).toBe(200);
      const tracker = new ArticulatedProgressTracker(movement, difficulty);
      expect(tracker.canonical.articulatedTolerance).toBe(0.25);
      expect(JSON.stringify(movement)).toBe(before);
      expect(
        scoreCompletedMovement(
          source.trajectory,
          source.trajectory.map((p) => p.articulated3d!),
        ).distance,
      ).toBeLessThan(0.25);
      expect(replay(demo(true, -1).trajectory, movement, difficulty).events).toHaveLength(0);
    }
    expect(counts.at(-1)).toBeGreaterThan(counts[0]!);
    expect(counts.every((n, i) => i === 0 || n >= counts[i - 1]!)).toBe(true);
    expect(ARTICULATED_TOLERANCE).toBe(0.25);
    expect(ARTICULATED_CONFIDENCE).toBe(0.3);
  });
  it.each([20, 50, 75, 80, 100])("self-replays at difficulty %s", (difficulty) => {
    const r = replay(demo().trajectory, undefined, difficulty);
    expect(r.events, JSON.stringify(r.tracker.diagnostics())).toHaveLength(1);
  });
  it.each(["half", "normal", "double", "drops", "slow", "fast"])("handles temporal %s", (mode) => {
    let rows = demo().trajectory;
    if (mode === "half") rows = rows.filter((_, i) => i % 2 === 0);
    if (mode === "double")
      rows = rows.flatMap((p) => [p, { ...p, timestampMs: p.timestampMs + 30 }]);
    if (mode === "drops") rows = rows.filter((_, i) => i % 7 !== 3);
    if (mode === "slow") rows = rows.map((p) => ({ ...p, timestampMs: p.timestampMs * 2 }));
    if (mode === "fast") rows = rows.map((p) => ({ ...p, timestampMs: p.timestampMs / 2 }));
    expect(replay(rows).events).toHaveLength(1);
  });
  it("rejects static, endpoints alone, partial motion and disconnected observations", () => {
    const p = demo().trajectory;
    for (const rows of [
      p.map((r) => ({ ...p[0]!, timestampMs: r.timestampMs })),
      [p[0]!, p.at(-1)!],
      p.slice(0, 30),
      [p[0]!, { ...p[30]!, timestampMs: 3000 }, p.at(-1)!],
    ])
      expect(replay(rows).events).toHaveLength(0);
  });
  it("sequence completes once, rejects reverse and never wraps", () => {
    const d = demo(true),
      movement = buildArticulatedMovement([d], "sequence");
    expect(
      replay(
        [
          ...d.trajectory,
          ...d.trajectory.map((p) => ({ ...p, timestampMs: p.timestampMs + 5000 })),
        ],
        movement,
      ).events,
    ).toHaveLength(1);
    expect(
      replay(
        [...d.trajectory].reverse().map((p, i) => ({ ...p, timestampMs: i * 67 })),
        movement,
      ).events,
    ).toHaveLength(0);
  });
  it("rejects a reversed asymmetric cycle without an apex", () => {
    const d = demo();
    d.trajectory = Array.from({ length: 101 }, (_, i) => {
      const angle = (i / 100) * 2 * Math.PI,
        landmarks = points(0);
      landmarks[15]!.z = Math.sin(angle) * 0.7;
      landmarks[15]!.y += 0.5 * (1 - Math.cos(angle));
      return { timestampMs: i * 67, landmarks, articulated3d: articulatedBody(landmarks)! };
    });
    const movement = buildArticulatedMovement([d], "cycle");
    expect(replay(d.trajectory, movement).events).toHaveLength(1);
    expect(
      replay(
        [...d.trajectory].reverse().map((p, i) => ({ ...p, timestampMs: i * 67 })),
        movement,
      ).events,
    ).toHaveLength(0);
  });
  it("an incomplete wrong-direction cycle resets without contaminating the following correct cycle", () => {
    const wrong = demo(false, -1),
      correct = demo();
    const result = replay([
      ...wrong.trajectory,
      ...correct.trajectory.map((p) => ({ ...p, timestampMs: p.timestampMs + 4100 })),
    ]);
    expect(result.events).toHaveLength(1);
    expect(result.tracker.evaluations).toHaveLength(1);
    expect(result.tracker.candidates[0]!.restarts).toBeGreaterThan(1);
    expect(Number(result.tracker.evaluations[0]!.startMs)).toBeGreaterThan(3500);
  });
  it("candidate storage is bounded and independent references cannot borrow half paths", () => {
    const a = demo(),
      b = demo(false, -1, "other"),
      movement = buildArticulatedMovement([a, b], "cycle");
    const r = replay([...a.trajectory.slice(0, 30), ...b.trajectory.slice(30)], movement);
    expect(r.events).toHaveLength(0);
    expect(r.tracker.candidates).toHaveLength(2);
    expect(r.tracker.candidates.every((c) => c.buffer.length <= 100)).toBe(true);
  });
  it("counts successive cycles and ignores brief missing observations", () => {
    const path = demo().trajectory;
    const missing = path.map((p, i) => (i === 20 ? { ...p, articulated3d: undefined } : p));
    expect(replay(missing).events).toHaveLength(1);
    expect(
      replay([...path, ...path.map((p) => ({ ...p, timestampMs: p.timestampMs + 4100 }))]).events,
    ).toHaveLength(2);
    const interrupted = path.map((p, i) => ({
      ...p,
      timestampMs: p.timestampMs + (i >= 30 ? 2000 : 0),
    }));
    expect(replay(interrupted).events).toHaveLength(0);
  });
  it("only explicit teacher-requested endpoint holds require dwell", () => {
    const source = demo(true),
      movement = buildArticulatedMovement([source], "sequence");
    const reference = movement.references![0]!;
    reference.anchors = reference.anchors.map((a) => ({
      ...a,
      holdSource: "teacher_requested",
      holdMs: a.id === "start" ? 200 : 5000,
    }));
    movement.anchors = reference.anchors;
    const first = source.trajectory[0]!,
      last = source.trajectory.at(-1)!;
    const observed = [
      first,
      { ...first, timestampMs: 250 },
      ...source.trajectory.slice(1).map((p) => ({ ...p, timestampMs: p.timestampMs + 250 })),
    ];
    expect(replay(observed, movement).events).toHaveLength(0);
    const dwell = Array.from({ length: 12 }, (_, i) => ({
      ...last,
      timestampMs: last.timestampMs + 250 + (i + 1) * 500,
    }));
    expect(replay([...observed, ...dwell], movement).events).toHaveLength(1);
  });
});

describe("final 20-target contract", () => {
  it.each([1, 20, 50, 75, 80, 99, 100])(
    "cannot complete a cycle's outbound half at %s",
    (difficulty) => {
      const source = demo();
      const movement = buildArticulatedMovement([source], "cycle");
      expect(replay(source.trajectory.slice(0, 31), movement, difficulty).events).toHaveLength(0);
      expect(replay(source.trajectory, movement, difficulty).events).toEqual([
        { type: "REP_SUCCESS" },
      ]);
    },
  );
  it.each([1, 20, 50, 75, 80, 99, 100])(
    "does not admit a distinct nearby sequence terminal as its start at %s",
    (difficulty) => {
      const source = demo(true);
      const landmarks = points(0.02);
      source.trajectory[source.trajectory.length - 1] = {
        timestampMs: source.endMs,
        landmarks,
        articulated3d: articulatedBody(landmarks)!,
      };
      const movement = buildArticulatedMovement([source], "sequence");
      const terminal = source.trajectory.at(-1)!;
      expect(
        articulatedDistance(source.trajectory[0]!.articulated3d!, terminal.articulated3d!).distance,
      ).toBeLessThan(ARTICULATED_TOLERANCE);
      const tracker = new ArticulatedProgressTracker(movement, difficulty);
      expect(tracker.update(terminal)?.type).not.toBe("SEQUENCE_COMPLETE");
      expect(tracker.candidates[0]!.buffer).toHaveLength(0);
      const result = replay(source.trajectory, movement, difficulty);
      expect(
        result.events,
        JSON.stringify({
          targets: result.tracker.targets.map((t) => t.pose.timestampMs),
          candidates: result.tracker.candidates.map((c) => ({
            index: c.index,
            peak: c.peak,
            travel: c.travel,
            targetArc: c.targetArc,
            origin: c.alignmentOrigin?.timestampMs,
            reason: c.reason,
          })),
        }),
      ).toEqual([{ type: "SEQUENCE_COMPLETE" }]);
    },
  );
  it("does not manufacture an omitted directional turn from nearby endpoint geometry", () => {
    const values = [
      0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.65, 0.8,
      0.85, 0.9, 1,
    ];
    const source = demo(true);
    source.trajectory = values.map((value, i) => {
      const landmarks = points(value);
      return { timestampMs: i * 67, landmarks, articulated3d: articulatedBody(landmarks)! };
    });
    source.endMs = source.trajectory.at(-1)!.timestampMs;
    const movement = buildArticulatedMovement([source], "sequence");
    const resampled = source.trajectory.filter((_, i) => i !== 15);
    expect(replay(resampled, movement, 100).events).toHaveLength(0);
    const reverse = [...resampled].reverse().map((p, i) => ({ ...p, timestampMs: i * 67 }));
    expect(replay(reverse, movement, 100).events).toHaveLength(0);
  });
  it("measures local direction from the last reached target rather than individual jitter frames", () => {
    const source = demo(true);
    const movement = buildArticulatedMovement([source], "sequence");
    const tracker = new ArticulatedProgressTracker(movement, 100);
    const candidate = tracker.candidates[0]!;
    const first = source.trajectory[0]!;
    tracker.update(first);
    const landmarks = points(-0.01);
    const jitter = { timestampMs: 34, landmarks, articulated3d: articulatedBody(landmarks)! };
    tracker.update(jitter);
    expect(candidate.index).toBe(0);
    expect(candidate.buffer.at(-1)).toBe(jitter);
    expect(candidate.alignmentOrigin).toBe(first);
    const next = candidate.targets[1]!.pose as NormalizedPose;
    tracker.update(next);
    expect(candidate.index).toBeGreaterThan(0);
    expect(candidate.alignmentOrigin).toBe(next);
  });
  it("maps all 100 difficulty levels monotonically without a 99/100 jump", () => {
    const counts = Array.from({ length: 100 }, (_, i) => difficultyToTargetCount(i + 1));
    expect(MAX_TRAJECTORY_TARGETS).toBe(20);
    expect([1, 20, 50, 75, 80, 99, 100].map(difficultyToTargetCount)).toEqual([
      4, 7, 12, 16, 17, 20, 20,
    ]);
    expect(counts.every((n, i) => n >= 3 && n <= 20 && (!i || n >= counts[i - 1]!))).toBe(true);
    expect(difficultyToTargetCount(NaN)).toBe(16);
    expect(difficultyToTargetCount(-1)).toBe(4);
    expect(difficultyToTargetCount(101)).toBe(20);
  });
  it("retains endpoints and the geometric turn as actual source poses at every density", () => {
    const path = demo().trajectory;
    for (const difficulty of [1, 20, 50, 75, 80, 99, 100]) {
      const targets = selectArticulatedTargets(path, difficultyToTargetCount(difficulty));
      expect(targets).toHaveLength(difficultyToTargetCount(difficulty));
      expect(targets[0]!.pose).toBe(path[0]);
      expect(targets.at(-1)!.pose).toBe(path.at(-1));
      expect(targets.some((t) => t.pose === path[30])).toBe(true);
      expect(targets.every((t) => t.pose === path[t.sourceIndex])).toBe(true);
    }
  });
  it("pauses and timestamp scaling do not consume geometric targets", () => {
    const path = demo(true).trajectory;
    const paused = path
      .flatMap((p, i) => Array.from({ length: i === 30 ? 50 : 1 }, () => p))
      .map((p, i) => ({ ...p, timestampMs: i * 67 }));
    const geometry = (rows: NormalizedPose[]) =>
      selectArticulatedTargets(rows, 20).map((t) => t.pose.articulated3d);
    expect(geometry(paused)).toEqual(geometry(path));
    expect(geometry(path.map((p) => ({ ...p, timestampMs: p.timestampMs * 10 })))).toEqual(
      geometry(path),
    );
  });
  it("bounds accepted persisted samples, retains all raw observations and never mixes teachers", () => {
    const a = demo(),
      b = demo(false, -1, "other");
    const movement = buildArticulatedMovement([a, b], "cycle");
    for (const [i, r] of movement.references!.entries()) {
      expect(r.samples).toHaveLength(20);
      expect(r.sourceTrajectory).toBe([a, b][i]!.trajectory);
      expect(r.samples.every((t) => r.sourceTrajectory.includes(t.pose as NormalizedPose))).toBe(
        true,
      );
      expect(r.articulatedEvidence!.sourceIndices).toHaveLength(20);
    }
  });
  it("bounds old articulated dense references at runtime without mutating persisted geometry", () => {
    const source = demo();
    const movement = buildArticulatedMovement([source], "cycle");
    const reference = movement.references![0]!;
    reference.samples = source.trajectory.map((pose, i) => ({
      pose,
      phase: "sequence",
      progress01: i / 60,
    }));
    movement.samples = reference.samples;
    const before = JSON.stringify(movement);
    expect(new ArticulatedProgressTracker(movement, 100).targets).toHaveLength(20);
    expect(JSON.stringify(movement)).toBe(before);
  });
  it("has one monotonic cursor, bounded forward movement and the same ghost/coaching target", () => {
    const source = demo(true),
      movement = buildArticulatedMovement([source], "sequence");
    const tracker = new ArticulatedProgressTracker(movement, 100);
    let previous = 0;
    for (const pose of source.trajectory) {
      tracker.update(pose);
      const index = tracker.getExpectedIndex();
      expect(index).toBeGreaterThanOrEqual(previous);
      expect(index - previous).toBeLessThanOrEqual(3);
      expect(tracker.getGhostTarget()).toBe(tracker.targets[index]);
      expect(tracker.diagnostics().currentProgressPercent).toBe((index / 19) * 100);
      previous = index;
    }
    expect(tracker.diagnostics().currentProgressPercent).toBe(100);
  });
  it("completes an imperfect execution with less than perfect interpretable quality", () => {
    const source = demo(true),
      movement = buildArticulatedMovement([source], "sequence");
    const before = JSON.stringify(movement);
    const imperfect = source.trajectory.map((p) => {
      const landmarks = p.landmarks.map((v) => ({ ...v }));
      landmarks[16]!.z += 0.5;
      return { ...p, landmarks, articulated3d: articulatedBody(landmarks)! };
    });
    const result = replay(imperfect, movement, 100);
    expect(result.events).toEqual([{ type: "SEQUENCE_COMPLETE" }]);
    const d = result.tracker.diagnostics();
    expect(d.currentProgressPercent).toBe(100);
    expect(d.completionQualityPercent).toBeLessThan(99);
    expect(d.completionQualityPercent).toBeGreaterThan(0);
    expect(result.tracker.evaluations[0]!.worstFeature).toMatchObject({ kind: "bone", index: 6 });
    expect(JSON.stringify(movement)).toBe(before);
    expect(result.tracker.evaluations[0]!.accepted).toBe(true);
  });
  it("exact stored geometry has effectively perfect quality but an incomplete beginning cannot finish", () => {
    const source = demo(true),
      movement = buildArticulatedMovement([source], "sequence");
    const full = replay(source.trajectory, movement, 100);
    expect(full.tracker.diagnostics().completionQualityPercent).toBeGreaterThan(98);
    const partial = replay(source.trajectory.slice(0, 20), movement, 100);
    expect(partial.events).toHaveLength(0);
    expect(partial.tracker.diagnostics().qualityPercent).toBeGreaterThan(95);
    expect(partial.tracker.diagnostics().currentProgressPercent).toBeLessThan(100);
  });
  it.each([1, 20, 50, 75, 80, 99, 100])(
    "does not let held sequence endpoints manufacture intermediate motion at %s",
    (difficulty) => {
      const source = demo(true),
        movement = buildArticulatedMovement([source], "sequence");
      const rows = [
        source.trajectory[0]!,
        ...Array.from({ length: 60 }, (_, i) => ({
          ...source.trajectory.at(-1)!,
          timestampMs: (i + 1) * 67,
        })),
      ];
      const result = replay(rows, movement, difficulty);
      expect(result.events).toHaveLength(0);
      expect(result.tracker.diagnostics().currentProgressPercent).toBeLessThan(100);
    },
  );
});
