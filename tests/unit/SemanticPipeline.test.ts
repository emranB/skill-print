import { describe, expect, it } from "vitest";
import type { TeachingUnit } from "../../src/frontend/analyze/analyze.types";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";
import {
  buildLearnPreparation,
  extractStatements,
  statementsFromModel,
  type SemanticModel,
} from "../../src/frontend/apprentice/SemanticPipeline";

const units: TeachingUnit[] = [
  { id: "U1", text: "Keep the elbow high.", startMs: 0, endMs: 1200, source: "EXPLICIT_TEACHING" },
  { id: "U2", text: "Um, okay.", startMs: 1300, endMs: 1600, source: "EXPLICIT_TEACHING" },
  { id: "U3", text: "This is the finish here.", startMs: 1700, endMs: 2600, source: "EXPLICIT_TEACHING" },
];

function model(reply: unknown, prepared: unknown = {}): SemanticModel {
  return {
    extract: async () => reply,
    phrase: async () => ({ q: [] }),
    summarize: async () => ({ summary: "unused" }),
    prepare: async () => prepared,
  };
}

function lessonWith(knowledge: string[]): Lesson {
  return {
    schemaVersion: 1,
    id: "L1",
    name: "Arm circle",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
    teacherCalibration: {} as Lesson["teacherCalibration"],
    referencePose: { timestampMs: 0, landmarks: [] },
    demonstrations: [],
    canonicalMovement: { checkpoints: [] },
    knowledge: knowledge.map((statement, i) => ({
      id: `K${i}`,
      kind: "technique",
      statement,
      importance: 1 - i * 0.1,
      teacherConfirmed: true,
      provenance: { sourceClass: "EXPLICIT_TEACHING" },
    })),
    guardrails: [],
    trackingProfile: { requiredLandmarks: [], requiredFeatures: [] },
    sourceSessionId: "S1",
  };
}

describe("learn preparation", () => {
  it("uses validated model cues keyed by phase", async () => {
    const prepared = await buildLearnPreparation(
      lessonWith(["Keep the elbow high."]),
      model(null, { p: "What will you watch first as your arm rises?", c: [{ ph: "apex", t: "Elbow stays high" }] }),
    );
    expect(prepared.preparedBy).toBe("apprentice_model");
    expect(prepared.cues).toEqual({ apex: "Elbow stays high" });
  });

  it("falls back without cues when the model reply is invalid", async () => {
    const prepared = await buildLearnPreparation(lessonWith(["Keep the elbow high."]), model(null, { p: 3 }));
    expect(prepared.preparedBy).toBe("offline_fallback");
    expect(prepared.cues).toEqual({});
    expect(prepared.predictionQuestion).toContain("Arm circle");
  });

  it("never calls the model for a lesson with nothing taught", async () => {
    let called = false;
    const m = model(null);
    m.prepare = async () => {
      called = true;
      return {};
    };
    await buildLearnPreparation(lessonWith([]), m);
    expect(called).toBe(false);
  });
});

describe("statement extraction", () => {
  it("maps validated model output onto source units, keeping verbatim text and timing", () => {
    const statements = statementsFromModel(units, {
      s: [
        { i: 0, k: "technique", t: "elbow stays high", c: 0.9, d: 0 },
        { i: 2, k: "target", t: "finish position", c: 0.8, d: 1 },
      ],
    });
    expect(statements.map((s) => s.id)).toEqual(["U1-1", "U3-1"]);
    expect(statements[0]!.sourceText).toBe("Keep the elbow high.");
    expect(statements[1]!.refersToDemonstration).toBe(true);
    expect(statements.every((s) => s.extractor === "apprentice_model")).toBe(true);
  });

  it("splits one line into several statements with distinct ids", () => {
    const statements = statementsFromModel(units, {
      s: [
        { i: 0, k: "technique", t: "elbow high", c: 0.9 },
        { i: 0, k: "emphasis", t: "this matters", c: 0.7 },
      ],
    });
    expect(statements.map((s) => s.id)).toEqual(["U1-1", "U1-2"]);
  });

  it("rejects invalid model output and falls back to unclassified verbatim units", async () => {
    const statements = await extractStatements(units, model({ s: [{ i: 0, k: "squat_depth", t: "x", c: 3 }] }));
    expect(statements).toHaveLength(units.length);
    expect(statements.every((s) => s.kind === "unknown" && s.extractor === "unclassified_fallback")).toBe(true);
    expect(statements.map((s) => s.sourceText)).toEqual(units.map((u) => u.text));
  });

  it("offline extraction never classifies by rules", async () => {
    const statements = await extractStatements(units, null);
    expect(new Set(statements.map((s) => s.kind))).toEqual(new Set(["unknown"]));
  });
});
