import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const MEDIA_REL = "data/lesson-squat.mp4";
const MEDIA_ABS = path.resolve(MEDIA_REL);

/**
 * Fixture ground truth: what the expert actually teaches in this video.
 * Only this test knows these concepts; production code must discover them.
 */
const TEACHING_POINTS: Array<{ id: string; fromMs: number; toMs: number; concept: RegExp; expectAligned?: boolean }> = [
  { id: "T1", fromMs: 0, toMs: 7500, concept: /even pressure/i },
  { id: "T2", fromMs: 0, toMs: 7500, concept: /body up/i },
  { id: "T3", fromMs: 0, toMs: 7500, concept: /neutral/i },
  { id: "T4", fromMs: 7500, toMs: 21500, concept: /angle|range of motion/i },
  { id: "T5", fromMs: 7500, toMs: 21500, concept: /muscle|strength|nice and easy/i },
  { id: "T6", fromMs: 21500, toMs: 25200, concept: /below parallel/i },
  { id: "T7", fromMs: 25200, toMs: 27200, concept: /chair/i },
  { id: "T8", fromMs: 27200, toMs: 33700, concept: /knees? out/i, expectAligned: true },
  { id: "T9", fromMs: 27200, toMs: 33700, concept: /pelvis|below (the )?knee/i, expectAligned: true },
  { id: "T10", fromMs: 33700, toMs: 35600, concept: /about parallel/i, expectAligned: true },
  { id: "T11", fromMs: 35600, toMs: 37400, concept: /below parallel/i, expectAligned: true },
  { id: "T12", fromMs: 37400, toMs: 38900, concept: /aim|target/i, expectAligned: true },
  { id: "T13", fromMs: 38900, toMs: 44500, concept: /starting out|mobility|fine/i },
  { id: "T14", fromMs: 44500, toMs: 55400, concept: /flexib|mobility|keep working/i },
  { id: "T15", fromMs: 55400, toMs: 63400, concept: /set of 10|all the way down/i, expectAligned: true },
  { id: "T16", fromMs: 63400, toMs: 66000, concept: /three sets/i },
];

/** Typed by the harness in place of the expert. Every use is flagged SIMULATED TEST RESPONSE. */
const SIMULATED_ANSWERS: Record<string, string> = {
  failure: "The knees cave inward on the way down. Push them out over the toes before going lower.",
  why: "Going below parallel uses the full range of the hips and knees, which builds strength through the whole movement.",
  judgment: "The crease of the hip ends up lower than the top of the knee.",
  boundary: "Use the chair until you can sit to the bottom and stand back up without losing balance.",
  exception: "If depth hurts the knees, stop at the depth you can control and build from there.",
  attention: "Watch that the knees stay pushed out and the chest stays up.",
  uncertainty: "I was showing the bottom position.",
  default: "Keep the chest up and the knees out. That matters most for a beginner.",
};

const PLACEHOLDERS = [/^Teacher emphasis/i, /^Confirmed\.?$/i, /Avoid collapsing the movement shape/i];

interface KnowledgeRecord {
  kind: string;
  statement: string;
  provenance: {
    sourceClass: string;
    transcriptText?: string;
    transcriptStartMs?: number;
    transcriptEndMs?: number;
    alignment?: string;
    simulated?: boolean;
    expertAnswer?: string;
  };
}

test.describe.configure({ mode: "serial" });

test("Level B real upload pipeline with semantic acceptance", async ({ page }) => {
  test.setTimeout(15 * 60 * 1000);
  expect(fs.existsSync(MEDIA_ABS), `Missing media file: ${MEDIA_ABS}`).toBe(true);

  const probe = spawnSync("node", ["src/scripts/level-b/probe-level-b-media.mjs", MEDIA_ABS], {
    encoding: "utf8",
    cwd: process.cwd(),
  });
  expect(probe.status, probe.stderr || "ffprobe failed").toBe(0);
  const metadata = JSON.parse(probe.stdout || "{}") as { ok?: boolean };
  expect(metadata.ok).toBe(true);

  await page.goto("/");
  await expect(page.getByText("APPLICATION_STARTED").first()).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(async () => (await fetch("/api/config")).ok);

  const pipeline = await page.evaluate(
    async ([mediaUrl, answers]) => {
      const mod = await import("/src/scripts/level-b/runLevelBPipeline.ts");
      return mod.runLevelBPipeline(mediaUrl as string, answers as Record<string, string>);
    },
    [`/${MEDIA_REL}`, SIMULATED_ANSWERS] as const,
  );

  const outDir = path.resolve("test-results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(
    path.join(outDir, "level-b-report.json"),
    JSON.stringify({ metadata, pipeline: { ...pipeline, transcript: undefined } }, null, 2),
  );

  const lesson = (pipeline.lesson ?? {}) as { knowledge?: KnowledgeRecord[]; guardrails?: KnowledgeRecord[] };
  const knowledge = lesson.knowledge ?? [];
  const guardrails = (lesson.guardrails ?? []) as KnowledgeRecord[];
  const narration = knowledge.filter((k) => k.provenance.sourceClass === "EXPLICIT_TEACHING");
  const squash = (s: string) => s.replace(/\s+/g, " ").trim();
  const spokenText = squash((pipeline.transcript?.words ?? []).map((w) => w.text).join(" "));
  const scribeText = squash(pipeline.transcript?.fullText ?? "");
  const isSpoken = (t?: string) => Boolean(t) && (spokenText.includes(squash(t!)) || scribeText.includes(squash(t!)));
  const unrealTranscriptText = narration.filter((k) => !isSpoken(k.provenance.transcriptText)).map((k) => k.provenance.transcriptText);
  const statements = ((pipeline.semantic as { statements?: Array<Record<string, unknown>> } | undefined)?.statements ??
    []) as Array<{ extractor: string; kind: string }>;

  const coverage = TEACHING_POINTS.map((point) => {
    const hit = narration.find((k) => {
      const start = k.provenance.transcriptStartMs ?? -1;
      const end = k.provenance.transcriptEndMs ?? start;
      const inRange = start < point.toMs && end > point.fromMs;
      return inRange && (point.concept.test(k.statement) || point.concept.test(k.provenance.transcriptText ?? ""));
    });
    return {
      id: point.id,
      covered: Boolean(hit),
      statement: hit?.statement,
      kind: hit?.kind,
      alignment: hit?.provenance.alignment ?? null,
      expectAligned: Boolean(point.expectAligned),
    };
  });

  const captureQuestions = ((pipeline.captureReview as { questions?: Array<{ question: string; gapType?: string }> })
    ?.questions ?? []);
  const debriefQuestions = ((pipeline.debrief as { questions?: Array<{ question: string }> })?.questions ?? []);
  const allStatements = [...knowledge, ...guardrails].map((k) => k.statement);
  const checks = {
    apprenticeModel: pipeline.apprenticeMode === "elevenlabs",
    allStatementsModelClassified: statements.length > 0 && statements.every((s) => s.extractor === "apprentice_model"),
    narrationCoverage: coverage.filter((c) => c.covered).length,
    alignedWhereDemonstrated: coverage.filter((c) => c.expectAligned && c.alignment === "ALIGNED").length,
    transcriptTextIsReal: narration.length > 0 && unrealTranscriptText.length === 0,
    answersNotInTranscriptText: knowledge
      .filter((k) => k.provenance.sourceClass === "EXPERT_ANSWER")
      .every((k) => k.provenance.transcriptText === undefined),
    noPlaceholders: allStatements.every((s) => !PLACEHOLDERS.some((p) => p.test(s))),
    guardrailQuestionAsked: captureQuestions.some((q) => q.gapType === "failure"),
    guardrailsNotInvented: guardrails.every(
      (g) => g.provenance.sourceClass !== "EXPLICIT_TEACHING" || /avoid|don't|do not|never/i.test(g.provenance.transcriptText ?? ""),
    ),
    simulatedAnswersFlagged: [...knowledge, ...guardrails]
      .filter((k) => k.provenance.sourceClass === "EXPERT_ANSWER")
      .every((k) => k.provenance.simulated === true),
    captureCount: captureQuestions.length,
    debriefCount: debriefQuestions.length,
    debriefDistinctFromCapture: debriefQuestions.every(
      (d) => !captureQuestions.some((c) => c.question.trim().toLowerCase() === d.question.trim().toLowerCase()),
    ),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    media: MEDIA_REL,
    apprenticeMode: pipeline.apprenticeMode,
    status: pipeline.status,
    timingsMs: pipeline.timingsMs,
    segmentation: pipeline.cycles,
    statements: (pipeline.semantic as { statements?: unknown[] } | undefined)?.statements,
    captureReview: pipeline.captureReview,
    debrief: pipeline.debrief,
    teachBack: pipeline.teachBack,
    workMap: { knowledge, guardrails },
    coverage,
    checks,
    unrealTranscriptText,
    simulated: {
      note: "Expert answers, demonstration labels and teach-back confirmation were typed by the harness. Each is a SIMULATED TEST RESPONSE.",
      answers: SIMULATED_ANSWERS,
    },
  };
  fs.writeFileSync(path.join(outDir, "level-b-semantic-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ status: pipeline.status, coverage, checks }, null, 2));

  expect(pipeline.status, pipeline.reason).toBe("PASS");
  expect(pipeline.scribeStatus).toBe("PASS");
  expect(pipeline.momentPlayer?.ok).toBe(true);
  expect(pipeline.persistence?.saved).toBe(true);
  expect(checks.apprenticeModel, "ElevenLabs apprentice must be configured; SKIPPED IS NOT PASS").toBe(true);
  expect(checks.allStatementsModelClassified).toBe(true);
  expect(checks.narrationCoverage).toBeGreaterThanOrEqual(13);
  expect(checks.alignedWhereDemonstrated).toBeGreaterThanOrEqual(4);
  expect(checks.transcriptTextIsReal).toBe(true);
  expect(checks.answersNotInTranscriptText).toBe(true);
  expect(checks.noPlaceholders).toBe(true);
  expect(checks.guardrailQuestionAsked).toBe(true);
  expect(checks.guardrailsNotInvented).toBe(true);
  expect(checks.simulatedAnswersFlagged).toBe(true);
  expect(checks.captureCount).toBeGreaterThanOrEqual(3);
  expect(checks.debriefCount).toBeGreaterThanOrEqual(3);
  expect(checks.debriefDistinctFromCapture).toBe(true);
});
