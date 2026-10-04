import type { RuntimeConfig } from "../../shared/config/config.types";
import type { ApprenticeGateway } from "../apprentice/ApprenticeGateway";
import { excludeWindows, type InterviewWindow } from "../apprentice/LiveInterview";
import { DebugBus } from "../debug/DebugBus";
import { alignStatements } from "./StatementAligner";
import { transcriptToUnits } from "./TimelineAligner";
import type { QuestionCandidate, SessionAnalysis, TeachingStatement, TeachingUnit } from "./analyze.types";

/**
 * Turn the expert's narration into timestamped TeachingStatements (model) and
 * attach per-statement geometric evidence (deterministic). Used by the app and
 * by the Level B harness so both run the same pipeline.
 */
export async function enrichAnalysisWithTeaching(
  analysis: SessionAnalysis,
  gateway: ApprenticeGateway,
  config: RuntimeConfig,
  interviewWindows: InterviewWindow[] = [],
): Promise<SessionAnalysis> {
  const narration = analysis.transcript
    ? { ...analysis.transcript, words: excludeWindows(analysis.transcript.words, interviewWindows) }
    : undefined;
  const units = transcriptToUnits(narration);
  const statements = await gateway.extractTeachingStatements({ units });
  const statementEvidence = alignStatements(statements, analysis.poseRecording.frames, analysis.demonstrations, {
    lookBeforeMs: config.review.clipBeforeMs,
    lookAfterMs: config.review.clipAfterMs,
  });
  DebugBus.emit({
    category: "ANALYSIS",
    event: "TEACHING_ALIGNED",
    data: {
      units: units.length,
      statements: statements.length,
      aligned: statementEvidence.filter((e) => e.alignment === "ALIGNED").length,
      partial: statementEvidence.filter((e) => e.alignment === "PARTIAL").length,
      unaligned: statementEvidence.filter((e) => e.alignment === "UNALIGNED").length,
    },
  });
  return { ...analysis, statements, statementEvidence };
}

/** Classify expert answers with the same taxonomy as narration. */
export async function extractAnswerStatements(
  answered: QuestionCandidate[],
  gateway: ApprenticeGateway,
): Promise<TeachingStatement[]> {
  const units: TeachingUnit[] = answered
    .filter((q) => q.status === "answered" && q.answer?.trim())
    .map((q, i) => ({
      id: `A${i + 1}`,
      text: q.answer!.trim(),
      source: "EXPERT_ANSWER" as const,
      questionId: q.id,
      questionText: q.question,
      startMs: q.clipStartMs,
      endMs: q.clipEndMs,
    }));
  return gateway.extractTeachingStatements({ units });
}
