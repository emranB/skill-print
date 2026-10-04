import { describe, expect, it } from "vitest";
import { CoachingSession } from "../../src/frontend/learn/CoachingSession";
import { MockApprenticeGateway } from "../../src/frontend/apprentice/MockApprenticeGateway";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";
import type { NormalizedLandmark } from "../../src/frontend/pose/pose.types";

const body = (kneeY: number): { landmarks: NormalizedLandmark[] } => ({
  landmarks: Array.from({ length: 33 }, (_, i) => ({ x: 0, y: i === 25 ? kneeY : 0, z: 0, visibility: 0.9 })),
});

const lesson = {
  id: "L1",
  name: "Lunge",
  canonicalMovement: { checkpoints: [{ index: 0, progress: 0, phase: "outbound", pose: body(0) }] },
  knowledge: [],
  guardrails: [],
} as unknown as Lesson;

const config = { mismatchPersistenceMs: 500, minimumPromptIntervalMs: 2500 };
const mismatch = { type: "MISMATCH" as const, index: 0, similarity: 0.3 };

describe("coaching session", () => {
  it("waits for the mismatch to persist, then combines the joint correction with the prepared cue", () => {
    const session = new CoachingSession(
      new MockApprenticeGateway(),
      config,
      lesson,
      { predictionQuestion: "q", cues: { outbound: "Step long and stay tall." }, preparedBy: "apprentice_model" },
      0.5,
    );
    expect(session.handleTrackerEvent(0, mismatch, body(1))).toBeNull();
    expect(session.handleTrackerEvent(200, mismatch, body(1))).toBeNull();
    expect(session.handleTrackerEvent(600, mismatch, body(1))).toBe("Bring your left knee higher. Step long and stay tall.");
    expect(session.handleTrackerEvent(1200, mismatch, body(1))).toBeNull();
    expect(session.correctionCount).toBe(1);
  });

  it("falls back to the checkpoint when there is no measurable joint error and no prepared cue", () => {
    const session = new CoachingSession(new MockApprenticeGateway(), config, lesson, null, 0.5);
    session.handleTrackerEvent(0, mismatch, body(0));
    expect(session.handleTrackerEvent(600, mismatch, body(0))).toBe("Match the teacher at 0% outbound.");
  });
});
