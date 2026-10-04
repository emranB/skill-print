import { describe, expect, it } from "vitest";
import { alignStatements } from "../../src/frontend/analyze/StatementAligner";
import { alignTranscriptToWindow, transcriptToUnits } from "../../src/frontend/analyze/TimelineAligner";
import type { TeachingStatement, Transcript } from "../../src/frontend/analyze/analyze.types";
import type { Demonstration, Landmark, PoseFrame } from "../../src/frontend/pose/pose.types";

function standing(): Landmark[] {
  const lm: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.95 }));
  lm[11] = { x: 0.42, y: 0.3, z: 0, visibility: 0.95 };
  lm[12] = { x: 0.58, y: 0.3, z: 0, visibility: 0.95 };
  lm[13] = { x: 0.4, y: 0.42, z: 0, visibility: 0.95 };
  lm[14] = { x: 0.6, y: 0.42, z: 0, visibility: 0.95 };
  lm[15] = { x: 0.4, y: 0.52, z: 0, visibility: 0.95 };
  lm[16] = { x: 0.6, y: 0.52, z: 0, visibility: 0.95 };
  lm[23] = { x: 0.45, y: 0.55, z: 0, visibility: 0.95 };
  lm[24] = { x: 0.55, y: 0.55, z: 0, visibility: 0.95 };
  lm[25] = { x: 0.45, y: 0.72, z: 0, visibility: 0.95 };
  lm[26] = { x: 0.55, y: 0.72, z: 0, visibility: 0.95 };
  lm[27] = { x: 0.45, y: 0.9, z: 0, visibility: 0.95 };
  lm[28] = { x: 0.55, y: 0.9, z: 0, visibility: 0.95 };
  return lm;
}

/** Arms rise between 2s and 4s, otherwise still. */
function frames(): PoseFrame[] {
  const out: PoseFrame[] = [];
  for (let t = 0; t <= 8000; t += 100) {
    const lm = standing();
    const lift = t >= 2000 && t <= 4000 ? Math.sin(((t - 2000) / 2000) * Math.PI) : 0;
    lm[15] = { x: 0.3, y: 0.52 - 0.4 * lift, z: 0, visibility: 0.95 };
    lm[16] = { x: 0.7, y: 0.52 - 0.4 * lift, z: 0, visibility: 0.95 };
    lm[13] = { x: 0.35, y: 0.42 - 0.2 * lift, z: 0, visibility: 0.95 };
    lm[14] = { x: 0.65, y: 0.42 - 0.2 * lift, z: 0, visibility: 0.95 };
    out.push({ timestampMs: t, landmarks: lm, worldLandmarks: lm });
  }
  return out;
}

const demo: Demonstration = {
  id: "d1",
  startMs: 2000,
  apexMs: 3000,
  endMs: 4000,
  classification: "unknown",
  teacherConfirmed: false,
  trajectory: [],
};

function statement(id: string, startMs: number, endMs: number): TeachingStatement {
  return {
    id,
    unitId: id,
    kind: "technique",
    statement: id,
    sourceText: id,
    startMs,
    endMs,
    confidence: 0.9,
    refersToDemonstration: false,
    sourceClass: "EXPLICIT_TEACHING",
    extractor: "apprentice_model",
  };
}

describe("statement alignment", () => {
  it("aligns speech during movement, keeps verbal-only speech as UNALIGNED, and isolates evidence", () => {
    const evidence = alignStatements(
      [statement("during", 2400, 3200), statement("later", 6500, 7500)],
      frames(),
      [demo],
      { lookBeforeMs: 500, lookAfterMs: 500 },
    );
    const during = evidence.find((e) => e.statementId === "during")!;
    const later = evidence.find((e) => e.statementId === "later")!;
    expect(during.alignment).toBe("ALIGNED");
    expect(during.demonstrationId).toBe("d1");
    expect(during.geometryObservations.length).toBeGreaterThan(0);
    for (const o of during.geometryObservations) {
      expect(o.startMs).toBe(during.clipStartMs);
      expect(o.endMs).toBe(during.clipEndMs);
    }
    expect(later.alignment).toBe("UNALIGNED");
    expect(later.geometryObservations).toEqual([]);
  });

  it("finds geometry just before the speech when the teacher narrates afterwards", () => {
    const [e] = alignStatements([statement("after", 4100, 4800)], frames(), [demo], {
      lookBeforeMs: 1500,
      lookAfterMs: 500,
    });
    expect(e!.alignment).not.toBe("UNALIGNED");
  });
});

describe("transcript windows", () => {
  const transcript: Transcript = {
    schemaVersion: 1,
    words: [
      { text: "Reach", startMs: 0, endMs: 300 },
      { text: "up.", startMs: 300, endMs: 600 },
      { text: "Now", startMs: 900, endMs: 1100 },
      { text: "down.", startMs: 1100, endMs: 1500 },
    ],
  };

  it("assigns a boundary word to exactly one adjacent window", () => {
    const a = alignTranscriptToWindow(transcript, 0, 1000);
    const b = alignTranscriptToWindow(transcript, 1000, 2000);
    expect(a.map((w) => w.text)).toEqual(["Reach", "up."]);
    expect(b.map((w) => w.text)).toEqual(["Now", "down."]);
  });

  it("splits sentences on recognizer punctuation", () => {
    const units = transcriptToUnits(transcript);
    expect(units.map((u) => u.text)).toEqual(["Reach up.", "Now down."]);
    expect(units[1]!.startMs).toBe(900);
  });
});
