import { describe, expect, it } from "vitest";
import { compileLesson } from "../../src/frontend/lesson/LessonCompiler";
import { LessonSchema } from "../../src/frontend/lesson/LessonSchema";
import { buildTeachBackItems } from "../../src/frontend/lesson/TeachBackItems";
import type { Demonstration, NormalizedPose } from "../../src/frontend/pose/pose.types";
import type {
  CaptureReviewQuestion,
  StatementEvidence,
  TeachingStatement,
} from "../../src/frontend/analyze/analyze.types";

const pose: NormalizedPose = {
  timestampMs: 0,
  landmarks: Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 1 })),
};

const demo: Demonstration = {
  id: "d1",
  startMs: 0,
  apexMs: 500,
  endMs: 1000,
  classification: "good",
  teacherConfirmed: true,
  trajectory: [pose, { ...pose, timestampMs: 500 }, { ...pose, timestampMs: 1000 }],
};

const calibration = {
  capturedAtMs: 0,
  neutralPose: pose,
  shoulderWidth: 0.3,
  torsoLength: 0.4,
  hipWidth: 0.25,
  bodyHeightEstimate: 1,
  visibility: {},
};

const narration: TeachingStatement = {
  id: "U1-1",
  unitId: "U1",
  kind: "target",
  statement: "reach the line",
  sourceText: "So you want to reach the line here.",
  startMs: 200,
  endMs: 900,
  confidence: 0.9,
  refersToDemonstration: true,
  sourceClass: "EXPLICIT_TEACHING",
  extractor: "apprentice_model",
};

const evidence: StatementEvidence = {
  statementId: "U1-1",
  clipStartMs: 0,
  clipEndMs: 1000,
  demonstrationId: "d1",
  geometryObservations: [{ feature: "left_elbow_angle", description: "left_elbow_angle ranged 40 to 170" }],
  alignment: "ALIGNED",
  confidence: 0.8,
};

const question: CaptureReviewQuestion = {
  id: "q1",
  phase: "capture_review",
  type: "guardrail",
  gapType: "failure",
  question: "What is the most common mistake?",
  evidence: [],
  rationale: "test",
  confidence: 0.8,
  status: "answered",
  answer: "Dropping the elbow early.",
  simulatedAnswer: true,
  timestampMs: 500,
  clipStartMs: 0,
  clipEndMs: 1000,
};

const answerStatement: TeachingStatement = {
  id: "A1-1",
  unitId: "A1",
  kind: "warning",
  statement: "do not drop the elbow early",
  sourceText: "Dropping the elbow early.",
  confidence: 0.9,
  refersToDemonstration: false,
  sourceClass: "EXPERT_ANSWER",
  extractor: "apprentice_model",
  questionId: "q1",
};

function compile(items: ReturnType<typeof buildTeachBackItems>) {
  return compileLesson({
    name: "Fixture Lesson",
    sourceSessionId: "s1",
    teacherCalibration: calibration,
    referencePose: pose,
    demonstrations: [demo],
    questions: [question],
    teachBackItems: items,
  });
}

describe("LessonCompiler", () => {
  it("keeps narration and answers in separate, truthful provenance fields", () => {
    const items = buildTeachBackItems([narration], [evidence], [answerStatement], [question]).map((i) => ({
      ...i,
      status: "confirmed" as const,
    }));
    const lesson = compile(items);
    expect(LessonSchema.safeParse(lesson).success).toBe(true);

    const k = lesson.knowledge[0]!;
    expect(k.provenance.sourceClass).toBe("EXPLICIT_TEACHING");
    expect(k.provenance.transcriptText).toBe(narration.sourceText);
    expect(k.provenance.alignment).toBe("ALIGNED");
    expect(k.provenance.geometry?.[0]?.feature).toBe("left_elbow_angle");

    const g = lesson.guardrails[0]!;
    expect(g.provenance.sourceClass).toBe("EXPERT_ANSWER");
    expect(g.provenance.transcriptText).toBeUndefined();
    expect(g.provenance.expertAnswer).toBe("Dropping the elbow early.");
    expect(g.provenance.questionText).toBe(question.question);
    expect(g.provenance.simulated).toBe(true);

    expect(lesson.canonicalMovement.checkpoints.length).toBe(9);
    expect(lesson.trackingProfile.requiredLandmarks.length).toBeGreaterThan(0);
  });

  it("applies teach-back corrections and drops rejected items", () => {
    const items = buildTeachBackItems([narration], [evidence], [answerStatement], [question]);
    const lesson = compile([
      { ...items[0]!, status: "corrected", correctedText: "reach the line with straight arms" },
      { ...items[1]!, status: "rejected" },
    ]);
    expect(lesson.knowledge).toHaveLength(1);
    expect(lesson.knowledge[0]!.statement).toBe("reach the line with straight arms");
    expect(lesson.knowledge[0]!.provenance.sourceClass).toBe("CONFIRMED_TEACH_BACK");
    expect(lesson.knowledge[0]!.provenance.correctedFrom).toBe("reach the line");
    expect(lesson.guardrails).toHaveLength(0);
  });

  it("compiles a repeated statement once", () => {
    const items = buildTeachBackItems([narration], [evidence], [], []).map((i) => ({ ...i, status: "confirmed" as const }));
    const lesson = compile([...items, { ...items[0]!, id: "dup", text: "Reach the line." }]);
    expect(lesson.knowledge).toHaveLength(1);
  });

  it("keeps the same words spoken at two different moments", () => {
    const items = buildTeachBackItems([narration], [evidence], [], []).map((i) => ({ ...i, status: "confirmed" as const }));
    const later = {
      ...items[0]!,
      id: "later",
      provenance: { ...items[0]!.provenance, transcriptStartMs: 5000, transcriptEndMs: 6000 },
    };
    expect(compile([...items, later]).knowledge).toHaveLength(2);
  });

  it("never compiles unreviewed teach-back items", () => {
    const items = buildTeachBackItems([narration], [evidence], [], []);
    expect(compile(items).knowledge).toHaveLength(0);
  });
});
