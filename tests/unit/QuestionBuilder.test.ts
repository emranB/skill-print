import { describe, expect, it } from "vitest";
import { findKnowledgeGaps, selectGaps } from "../../src/frontend/analyze/QuestionBuilder";
import type {
  SessionAnalysis,
  StatementEvidence,
  TeachingStatement,
} from "../../src/frontend/analyze/analyze.types";
import { buildCaptureReview, buildDebrief } from "../../src/frontend/apprentice/SemanticPipeline";
import { QuestionCandidateSchema } from "../../src/frontend/lesson/LessonSchema";
import type { Demonstration } from "../../src/frontend/pose/pose.types";

const config = {
  schemaVersion: 1 as const,
  pose: { leniency: 0.25, minimumVisibility: 0.65, sampleFps: 15, checkpointHoldMs: 150 },
  calibration: { lostTrackingMs: 1000 },
  review: { clipBeforeMs: 1500, clipAfterMs: 1500, maximumQuestions: 6 },
  coaching: { mismatchPersistenceMs: 500, minimumPromptIntervalMs: 2500 },
  debug: { enabled: true },
};

const demo: Demonstration = {
  id: "d1",
  startMs: 1000,
  apexMs: 3000,
  endMs: 5000,
  classification: "unknown",
  teacherConfirmed: false,
  trajectory: [],
};

function statement(id: string, unitId: string, kind: TeachingStatement["kind"], startMs: number, text: string): TeachingStatement {
  return {
    id,
    unitId,
    kind,
    statement: text,
    sourceText: text,
    startMs,
    endMs: startMs + 1000,
    confidence: 0.9,
    refersToDemonstration: false,
    sourceClass: "EXPLICIT_TEACHING",
    extractor: "apprentice_model",
  };
}

function evidence(statementId: string, alignment: StatementEvidence["alignment"], startMs: number): StatementEvidence {
  return {
    statementId,
    clipStartMs: startMs - 500,
    clipEndMs: startMs + 1500,
    demonstrationId: alignment === "UNALIGNED" ? undefined : "d1",
    geometryObservations: [],
    alignment,
    confidence: 0.8,
  };
}

function analysisWith(statements: TeachingStatement[], ev: StatementEvidence[]): SessionAnalysis {
  return {
    sessionId: "s",
    poseRecording: { schemaVersion: 1, id: "r", sessionId: "s", frames: [] },
    demonstrations: [demo],
    observations: [],
    statements,
    statementEvidence: ev,
  };
}

describe("knowledge gaps", () => {
  it("asks why for an unexplained target but not when the next statement gives the reason", () => {
    const unexplained = analysisWith(
      [statement("U1-1", "U1", "target", 2000, "Aim for the line.")],
      [evidence("U1-1", "ALIGNED", 2000)],
    );
    expect(findKnowledgeGaps(unexplained, config).some((g) => g.type === "why" && g.statementId === "U1-1")).toBe(true);

    const explained = analysisWith(
      [
        statement("U1-1", "U1", "target", 2000, "Aim for the line."),
        statement("U2-1", "U2", "reason", 3200, "That builds control."),
      ],
      [evidence("U1-1", "ALIGNED", 2000), evidence("U2-1", "PARTIAL", 3200)],
    );
    expect(findKnowledgeGaps(explained, config).some((g) => g.type === "why" && g.statementId === "U1-1")).toBe(false);
  });

  it("asks for the failure mode only when no warning was stated, and never fills in the answer", () => {
    const gaps = findKnowledgeGaps(
      analysisWith([statement("U1-1", "U1", "technique", 2000, "Lead with the elbow.")], [evidence("U1-1", "ALIGNED", 2000)]),
      config,
    );
    const failure = gaps.find((g) => g.type === "failure");
    expect(failure?.statementId).toBe("U1-1");

    const warned = findKnowledgeGaps(
      analysisWith(
        [
          statement("U1-1", "U1", "technique", 2000, "Lead with the elbow."),
          statement("U2-1", "U2", "warning", 3500, "Never lock the wrist."),
        ],
        [evidence("U1-1", "ALIGNED", 2000), evidence("U2-1", "ALIGNED", 3500)],
      ),
      config,
    );
    expect(warned.find((g) => g.type === "failure")?.statementId).toBe("U2-1");
  });

  it("does not ask the boundary of a modification that the next statement already explains", () => {
    const gaps = findKnowledgeGaps(
      analysisWith(
        [
          statement("U1-1", "U1", "modification", 2000, "Use a support if needed."),
          statement("U2-1", "U2", "progression", 3200, "Drop the support as balance improves."),
        ],
        [evidence("U1-1", "PARTIAL", 2000), evidence("U2-1", "PARTIAL", 3200)],
      ),
      config,
    );
    expect(gaps.some((g) => g.type === "boundary")).toBe(false);
  });

  it("selection keeps the failure gap and one gap per statement", () => {
    const gaps = findKnowledgeGaps(
      analysisWith([statement("U1-1", "U1", "target", 2000, "Reach the mark.")], [evidence("U1-1", "ALIGNED", 2000)]),
      config,
    );
    const chosen = selectGaps(gaps, 2);
    expect(chosen.some((g) => g.type === "failure")).toBe(true);
    expect(new Set(chosen.map((g) => g.statementId)).size).toBe(chosen.length);
  });
});

describe("offline capture review and debrief", () => {
  const analysis = analysisWith(
    [
      statement("U1-1", "U1", "target", 1500, "Aim for the line."),
      statement("U2-1", "U2", "technique", 2600, "Keep the hands soft."),
      statement("U3-1", "U3", "modification", 4000, "Hold a rail if you need."),
    ],
    [evidence("U1-1", "ALIGNED", 1500), evidence("U2-1", "ALIGNED", 2600), evidence("U3-1", "PARTIAL", 4000)],
  );

  it("produces >=3 schema-valid questions grounded in statements, including a guardrail", async () => {
    const questions = await buildCaptureReview(analysis, config, 6, null);
    expect(questions.length).toBeGreaterThanOrEqual(3);
    expect(questions.some((q) => q.type === "guardrail")).toBe(true);
    for (const q of questions) {
      expect(() => QuestionCandidateSchema.parse(q)).not.toThrow();
      if (q.phase === "capture_review") expect(q.clipEndMs).toBeGreaterThan(q.clipStartMs);
    }
    expect(questions.filter((q) => q.statementId).length).toBeGreaterThanOrEqual(2);
  });

  it("produces >=3 debrief follow-ups distinct from capture questions", async () => {
    const capture = await buildCaptureReview(analysis, config, 6, null);
    const answered = capture.map((q) => ({ ...q, status: "answered" as const, answer: `answer for ${q.id}` }));
    const debrief = await buildDebrief(answered, analysis, config, null);
    expect(debrief.length).toBeGreaterThanOrEqual(3);
    const asked = new Set(capture.map((q) => q.question));
    expect(debrief.every((q) => q.phase === "debrief" && !asked.has(q.question))).toBe(true);
  });
});
