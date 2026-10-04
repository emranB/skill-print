import type {
  QuestionCandidate,
  StatementEvidence,
  TeachingStatement,
} from "../analyze/analyze.types";
import type { KnowledgeProvenance } from "../pose/pose.types";

export type TeachBackStatus = "pending" | "confirmed" | "corrected" | "rejected";

export interface TeachBackItem {
  id: string;
  kind: string;
  text: string;
  status: TeachBackStatus;
  correctedText?: string;
  provenance: KnowledgeProvenance;
}

/**
 * Candidate lesson knowledge for the expert to confirm or correct: every
 * extracted narration statement plus every statement extracted from an
 * expert answer. Answers that yielded no statement are kept verbatim.
 */
export function buildTeachBackItems(
  narration: TeachingStatement[],
  evidence: StatementEvidence[],
  answerStatements: TeachingStatement[],
  answered: QuestionCandidate[],
): TeachBackItem[] {
  const evidenceById = new Map(evidence.map((e) => [e.statementId, e]));
  const questionById = new Map(answered.map((q) => [q.id, q]));
  const items: TeachBackItem[] = [];

  for (const s of narration) {
    const e = evidenceById.get(s.id);
    items.push({
      id: s.id,
      kind: s.kind,
      text: s.statement,
      status: "pending",
      provenance: {
        sourceClass: "EXPLICIT_TEACHING",
        statementId: s.id,
        transcriptText: s.sourceText,
        transcriptStartMs: s.startMs,
        transcriptEndMs: s.endMs,
        startMs: e?.clipStartMs ?? s.startMs,
        endMs: e?.clipEndMs ?? s.endMs,
        demonstrationId: e?.demonstrationId,
        alignment: e?.alignment ?? "UNALIGNED",
        geometry: e?.geometryObservations.slice(0, 4).map((g) => ({ feature: g.feature, description: g.description })),
        confidence: e?.confidence ?? s.confidence,
      },
    });
  }

  const covered = new Set<string>();
  for (const s of answerStatements) {
    const q = s.questionId ? questionById.get(s.questionId) : undefined;
    if (s.questionId) covered.add(s.questionId);
    items.push({
      id: s.id,
      kind: q?.type === "guardrail" && s.kind === "unknown" ? "warning" : s.kind,
      text: s.statement,
      status: "pending",
      provenance: answerProvenance(q, s.id, s.confidence),
    });
  }

  for (const q of answered) {
    if (q.status !== "answered" || !q.answer || covered.has(q.id)) continue;
    items.push({
      id: `A-${q.id}`,
      kind: q.type === "guardrail" ? "warning" : "unknown",
      text: q.answer,
      status: "pending",
      provenance: answerProvenance(q, undefined, 0.5),
    });
  }
  return items;
}

function answerProvenance(
  q: QuestionCandidate | undefined,
  statementId: string | undefined,
  confidence: number,
): KnowledgeProvenance {
  return {
    sourceClass: "EXPERT_ANSWER",
    statementId,
    questionId: q?.id,
    questionText: q?.question,
    expertAnswer: q?.answer,
    startMs: q?.clipStartMs,
    endMs: q?.clipEndMs,
    geometry: q?.evidence
      .filter((e) => e.feature !== "evidence_window")
      .slice(0, 4)
      .map((g) => ({ feature: g.feature, description: g.description })),
    confidence,
    simulated: q?.simulatedAnswer || undefined,
  };
}
