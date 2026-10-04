import { createId } from "../../shared/utils/id";
import { inWindow, windowsOverlap } from "../../shared/utils/interval";
import type { RuntimeConfig } from "../../shared/config/config.types";
import type { Demonstration } from "../pose/pose.types";
import type {
  AnalysisEvidence,
  CaptureReviewQuestion,
  DebriefQuestion,
  KnowledgeGap,
  KnowledgeGapType,
  QuestionCandidate,
  QuestionType,
  SessionAnalysis,
  StatementEvidence,
  TeachingStatement,
  TeachingStatementKind,
} from "./analyze.types";

const GAP_QUESTION_TYPE: Record<KnowledgeGapType, QuestionType> = {
  why: "reason",
  judgment: "importance",
  boundary: "variation",
  exception: "variation",
  attention: "importance",
  failure: "guardrail",
  uncertainty: "classification",
};

const ACTIONABLE: TeachingStatementKind[] = ["instruction", "technique", "target", "sequencing"];
const CONDITIONAL: TeachingStatementKind[] = ["modification", "exception", "progression"];

const ALIGN_WEIGHT = { ALIGNED: 1, PARTIAL: 0.6, UNALIGNED: 0.3 } as const;

function clipAround(timestampMs: number, config: RuntimeConfig): { clipStartMs: number; clipEndMs: number } {
  return {
    clipStartMs: Math.max(0, timestampMs - config.review.clipBeforeMs),
    clipEndMs: timestampMs + config.review.clipAfterMs,
  };
}

export function quote(text: string, max = 120): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 3).trimEnd()}...`;
}

interface Neighborhood {
  statement: TeachingStatement;
  evidence: StatementEvidence | undefined;
  neighbors: TeachingStatement[];
}

/** Statements from the same or an adjacent transcript unit. */
function neighborhoods(
  statements: TeachingStatement[],
  evidence: StatementEvidence[],
): Neighborhood[] {
  const unitOrder = [...new Set(statements.map((s) => s.unitId))];
  const position = new Map(unitOrder.map((id, i) => [id, i]));
  const byId = new Map(evidence.map((e) => [e.statementId, e]));
  return statements.map((statement) => {
    const p = position.get(statement.unitId) ?? 0;
    const neighbors = statements.filter((other) => {
      if (other.id === statement.id) return false;
      const q = position.get(other.unitId) ?? -99;
      return Math.abs(q - p) <= 1;
    });
    return { statement, evidence: byId.get(statement.id), neighbors };
  });
}

function evidenceFor(n: Neighborhood): AnalysisEvidence[] {
  return n.evidence?.geometryObservations ?? [];
}

function statementGap(
  n: Neighborhood,
  type: KnowledgeGapType,
  priority: number,
  rationale: string,
): KnowledgeGap {
  const startMs = n.evidence?.clipStartMs ?? n.statement.startMs ?? 0;
  const endMs = n.evidence?.clipEndMs ?? n.statement.endMs ?? startMs + 1;
  return {
    id: createId(),
    type,
    statementId: n.statement.id,
    demonstrationId: n.evidence?.demonstrationId,
    timestampMs: n.statement.startMs ?? startMs,
    clipStartMs: startMs,
    clipEndMs: Math.max(endMs, startMs + 1),
    evidence: evidenceFor(n),
    rationale,
    priority,
  };
}

/**
 * Deterministic knowledge-gap detection over extracted statements, their
 * geometric evidence, and the segmented demonstrations.
 *
 * Redundancy is checked structurally: a "why" is not asked when an adjacent
 * statement already gives a reason, a boundary is not asked when the next
 * statement already explains progression, and a guardrail gap asks for the
 * failure mode only when the expert never stated a warning.
 */
export function findKnowledgeGaps(analysis: SessionAnalysis, config: RuntimeConfig): KnowledgeGap[] {
  const statements = (analysis.statements ?? []).filter((s) => s.sourceClass === "EXPLICIT_TEACHING");
  const evidence = analysis.statementEvidence ?? [];
  const hoods = neighborhoods(statements, evidence);
  const gaps: KnowledgeGap[] = [];

  for (const n of hoods) {
    const { statement } = n;
    const alignment = n.evidence?.alignment ?? "UNALIGNED";
    const weight = ALIGN_WEIGHT[alignment];
    const neighborKinds = new Set(n.neighbors.map((s) => s.kind));

    if (ACTIONABLE.includes(statement.kind) && !neighborKinds.has("reason")) {
      gaps.push(
        statementGap(n, "why", 0.55 + 0.3 * weight + 0.1 * statement.confidence, "Stated without a reason"),
      );
    }
    if (statement.kind === "target" && alignment !== "UNALIGNED") {
      const demonstrated = statement.refersToDemonstration || n.neighbors.some((s) => s.refersToDemonstration);
      gaps.push(
        statementGap(
          n,
          "judgment",
          demonstrated ? 0.5 + 0.2 * weight : 0.6 + 0.25 * weight,
          demonstrated
            ? "Target was shown, but how a learner checks it on themselves was not said"
            : "Target was named without saying how a learner recognizes it",
        ),
      );
    }
    if (CONDITIONAL.includes(statement.kind)) {
      const explained = n.neighbors.some(
        (s) => (s.kind === "progression" || s.kind === "reason") && (s.startMs ?? 0) >= (statement.startMs ?? 0),
      );
      if (!explained) {
        gaps.push(
          statementGap(
            n,
            statement.kind === "modification" ? "boundary" : "exception",
            0.6 + 0.1 * statement.confidence,
            "Condition given without saying when it stops applying",
          ),
        );
      }
    }
    if (statement.kind === "unknown" && alignment === "ALIGNED") {
      gaps.push(statementGap(n, "uncertainty", 0.35 + 0.2 * weight, "Movement narrated but meaning unclear"));
    }
  }

  const narrated = (demo: Demonstration) =>
    hoods.some(
      (n) =>
        n.evidence?.alignment === "ALIGNED" &&
        n.statement.startMs !== undefined &&
        windowsOverlap(n.statement.startMs, (n.statement.endMs ?? n.statement.startMs) + 1, demo.startMs, demo.endMs),
    );
  const demos = analysis.demonstrations.filter((d) => d.classification !== "fragment" && d.classification !== "ignore");
  for (const demo of demos) {
    if (narrated(demo)) continue;
    const clip = clipAround(demo.apexMs, config);
    gaps.push({
      id: createId(),
      type: "attention",
      demonstrationId: demo.id,
      timestampMs: demo.apexMs,
      ...clip,
      evidence: analysis.observations.filter(
        (o) => o.startMs !== undefined && inWindow(o.startMs, demo.startMs, demo.endMs),
      ),
      rationale: "Repetition was performed without narration",
      priority: 0.45,
    });
  }

  const warnings = hoods.filter((n) => n.statement.kind === "warning");
  if (warnings.length === 0) {
    const anchor =
      [...hoods]
        .filter((n) => ACTIONABLE.includes(n.statement.kind) || n.statement.kind === "emphasis")
        .sort(
          (a, b) =>
            ALIGN_WEIGHT[b.evidence?.alignment ?? "UNALIGNED"] - ALIGN_WEIGHT[a.evidence?.alignment ?? "UNALIGNED"] ||
            b.statement.confidence - a.statement.confidence,
        )[0] ?? null;
    if (anchor) {
      gaps.push(statementGap(anchor, "failure", 1, "The expert never named a mistake or what to avoid"));
    } else {
      const demo = demos[0] ?? analysis.demonstrations[0];
      if (demo) {
        const clip = clipAround(demo.apexMs, config);
        gaps.push({
          id: createId(),
          type: "failure",
          demonstrationId: demo.id,
          timestampMs: demo.apexMs,
          ...clip,
          evidence: analysis.observations.filter(
            (o) => o.startMs !== undefined && inWindow(o.startMs, demo.startMs, demo.endMs),
          ),
          rationale: "No mistakes or limits were described for this movement",
          priority: 1,
        });
      }
    }
  } else {
    const top = warnings.sort((a, b) => b.statement.confidence - a.statement.confidence)[0]!;
    gaps.push(statementGap(top, "failure", 0.9, "Warning stated without saying how to notice it early"));
  }

  return gaps;
}

/** Highest-priority gaps with at most one gap per statement and two per type. The failure gap is always kept. */
export function selectGaps(gaps: KnowledgeGap[], max: number): KnowledgeGap[] {
  const sorted = [...gaps].sort((a, b) => b.priority - a.priority);
  const chosen: KnowledgeGap[] = [];
  const usedStatements = new Set<string>();
  const perType = new Map<KnowledgeGapType, number>();
  const failure = sorted.find((g) => g.type === "failure");
  if (failure) {
    chosen.push(failure);
    if (failure.statementId) usedStatements.add(failure.statementId);
    perType.set("failure", 1);
  }
  for (const gap of sorted) {
    if (chosen.length >= max) break;
    if (gap === failure) continue;
    if (gap.statementId && usedStatements.has(gap.statementId)) continue;
    if ((perType.get(gap.type) ?? 0) >= 2) continue;
    chosen.push(gap);
    if (gap.statementId) usedStatements.add(gap.statementId);
    perType.set(gap.type, (perType.get(gap.type) ?? 0) + 1);
  }
  return chosen.sort((a, b) => a.timestampMs - b.timestampMs);
}

/** Offline phrasing used only when the apprentice model is unavailable. */
export function fallbackGapQuestion(gap: KnowledgeGap, statement?: TeachingStatement): string {
  const said = statement ? `You said "${quote(statement.sourceText)}". ` : "";
  switch (gap.type) {
    case "why":
      return `${said}Why does that matter for a learner?`;
    case "judgment":
      return `${said}How can a learner tell on their own body that they have reached it?`;
    case "boundary":
      return `${said}When should a learner stop relying on that?`;
    case "exception":
      return `${said}When does that no longer apply?`;
    case "attention":
      return "You did not narrate this repetition. What should a learner watch for here?";
    case "failure":
      return `${said}What is the most common mistake here, and how would a learner notice it early?`;
    case "uncertainty":
      return `${said}What were you showing at this moment?`;
  }
}

export function gapToCaptureQuestion(gap: KnowledgeGap, text: string, confidence = 0.7): CaptureReviewQuestion {
  return {
    id: createId(),
    phase: "capture_review",
    type: GAP_QUESTION_TYPE[gap.type],
    gapType: gap.type,
    statementId: gap.statementId,
    question: text,
    evidence: gap.evidence.length
      ? gap.evidence
      : [
          {
            feature: "evidence_window",
            description: gap.rationale,
            startMs: gap.clipStartMs,
            endMs: gap.clipEndMs,
          },
        ],
    rationale: gap.rationale,
    confidence,
    status: "pending",
    timestampMs: gap.timestampMs,
    clipStartMs: gap.clipStartMs,
    clipEndMs: gap.clipEndMs,
  };
}

/**
 * Follow-up gaps for the debrief: deepen the expert's own answers, ask for
 * priority among learned points, and carry over gaps that Capture Review had
 * no room for.
 */
export interface DebriefGap {
  type: "followup" | "priority" | KnowledgeGapType;
  questionType: QuestionType;
  sourceQuestion?: QuestionCandidate;
  statement?: TeachingStatement;
  options?: string[];
  evidence: AnalysisEvidence[];
  rationale: string;
}

export function findDebriefGaps(
  answered: QuestionCandidate[],
  analysis: SessionAnalysis,
  leftover: KnowledgeGap[],
): DebriefGap[] {
  const gaps: DebriefGap[] = [];
  const done = answered.filter((q) => q.status === "answered" && q.answer);
  const guard = done.find((q) => q.type === "guardrail");
  if (guard) {
    gaps.push({
      type: "followup",
      questionType: "guardrail",
      sourceQuestion: guard,
      evidence: guard.evidence,
      rationale: "Turn the stated mistake into a correction the learner can act on",
    });
  }
  const learned = (analysis.statements ?? []).filter(
    (s) => s.kind !== "unknown" && s.kind !== "prescription" && s.confidence >= 0.5,
  );
  if (learned.length >= 2) {
    gaps.push({
      type: "priority",
      questionType: "importance",
      options: learned.slice(0, 4).map((s) => s.statement),
      evidence: [],
      rationale: "Several points were taught; their relative priority was not stated",
    });
  }
  const statements = new Map((analysis.statements ?? []).map((s) => [s.id, s]));
  for (const gap of leftover) {
    gaps.push({
      type: gap.type,
      questionType: GAP_QUESTION_TYPE[gap.type],
      statement: gap.statementId ? statements.get(gap.statementId) : undefined,
      evidence: gap.evidence,
      rationale: `Carried over from Capture Review: ${gap.rationale}`,
    });
  }
  for (const q of done) {
    if (q === guard) continue;
    gaps.push({
      type: "followup",
      questionType: q.type,
      sourceQuestion: q,
      evidence: q.evidence,
      rationale: "Deepen an earlier answer",
    });
  }
  return gaps;
}

export function fallbackDebriefQuestion(gap: DebriefGap): string {
  const answer = gap.sourceQuestion?.answer ? quote(gap.sourceQuestion.answer, 100) : "";
  if (gap.type === "followup" && gap.questionType === "guardrail") {
    return `You said "${answer}". What would you tell a learner the moment you see that happening?`;
  }
  if (gap.type === "followup") {
    return `You said "${answer}". Can you give a learner one concrete check for that?`;
  }
  if (gap.type === "priority") {
    return `Of these, which matters most for a beginner and why: ${(gap.options ?? []).map((o) => `"${quote(o, 60)}"`).join(", ")}?`;
  }
  return fallbackGapQuestion(
    {
      id: "",
      type: gap.type,
      timestampMs: 0,
      clipStartMs: 0,
      clipEndMs: 1,
      evidence: [],
      rationale: gap.rationale,
      priority: 0,
    },
    gap.statement,
  );
}

export function debriefGapToQuestion(gap: DebriefGap, text: string, confidence = 0.6): DebriefQuestion {
  return {
    id: createId(),
    phase: "debrief",
    type: gap.questionType,
    gapType: gap.type === "followup" || gap.type === "priority" ? undefined : gap.type,
    statementId: gap.statement?.id,
    question: text,
    evidence: gap.evidence,
    rationale: gap.rationale,
    confidence,
    status: "pending",
  };
}
