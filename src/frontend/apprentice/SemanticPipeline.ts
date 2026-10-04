import type { RuntimeConfig } from "../../shared/config/config.types";
import {
  debriefGapToQuestion,
  fallbackDebriefQuestion,
  fallbackGapQuestion,
  findDebriefGaps,
  findKnowledgeGaps,
  gapToCaptureQuestion,
  quote,
  selectGaps,
  type DebriefGap,
} from "../analyze/QuestionBuilder";
import type {
  KnowledgeGap,
  QuestionCandidate,
  SessionAnalysis,
  TeachingStatement,
  TeachingUnit,
} from "../analyze/analyze.types";
import { DebugBus } from "../debug/DebugBus";
import type { LearnPreparation } from "./ApprenticeGateway";
import type { Lesson } from "../lesson/lesson.types";
import {
  ExtractionResponseSchema,
  LearnPreparationResponseSchema,
  QuestionCandidateSchema,
  QuestionPhrasingResponseSchema,
  TeachBackResponseSchema,
  TeachingStatementSchema,
} from "../lesson/LessonSchema";
import type { TeachBackItem } from "../lesson/TeachBackItems";

export interface PhraseGap {
  g: number;
  type: string;
  quote?: string;
  answer?: string;
  context?: string;
  observed?: string;
}

/** What the apprentice already knows about the skill, so it does not ask about it again. */
export interface PhraseContext {
  skill?: string;
  known?: string[];
}

export interface LearnPrepInput {
  skill: string;
  knowledge: Array<{ kind: string; text: string }>;
  guardrails: string[];
}

/** Raw model calls. Every return value is untrusted and validated here. */
export interface SemanticModel {
  extract(units: Array<{ i: number; text: string; startMs?: number; endMs?: number; question?: string }>): Promise<unknown>;
  phrase(phase: "capture_review" | "debrief", gaps: PhraseGap[], context: PhraseContext): Promise<unknown>;
  summarize(items: Array<{ i: number; kind: string; text: string }>, skill?: string): Promise<unknown>;
  prepare(input: LearnPrepInput): Promise<unknown>;
}

const KNOWN_LIMIT = 8;

/** Classified statements, most confident first, as short known points for the phrasing prompt. */
function knownPoints(analysis: SessionAnalysis, extra: string[] = []): string[] {
  const classified = (analysis.statements ?? [])
    .filter((s) => s.kind !== "unknown")
    .sort((a, b) => b.confidence - a.confidence)
    .map((s) => quote(s.statement, 160));
  return [...new Set([...extra.map((e) => quote(e, 160)), ...classified])].slice(0, KNOWN_LIMIT);
}

function baseStatement(unit: TeachingUnit): Omit<TeachingStatement, "id" | "kind" | "statement" | "confidence" | "refersToDemonstration" | "extractor"> {
  return {
    unitId: unit.id,
    sourceText: unit.text,
    startMs: unit.startMs,
    endMs: unit.endMs,
    sourceClass: unit.source,
    questionId: unit.questionId,
    questionText: unit.questionText,
  };
}

/** No model available: keep every unit verbatim with kind "unknown". Clearly marked, never classified by rules. */
export function fallbackStatements(units: TeachingUnit[]): TeachingStatement[] {
  return units.map((unit) =>
    TeachingStatementSchema.parse({
      ...baseStatement(unit),
      id: `${unit.id}-1`,
      kind: "unknown",
      statement: unit.text,
      confidence: 0.3,
      refersToDemonstration: false,
      extractor: "unclassified_fallback",
    }),
  );
}

export function statementsFromModel(units: TeachingUnit[], raw: unknown): TeachingStatement[] {
  const parsed = ExtractionResponseSchema.parse(raw);
  const counters = new Map<number, number>();
  const out: TeachingStatement[] = [];
  for (const entry of parsed.s) {
    const unit = units[entry.i];
    if (!unit) continue;
    const n = (counters.get(entry.i) ?? 0) + 1;
    counters.set(entry.i, n);
    out.push(
      TeachingStatementSchema.parse({
        ...baseStatement(unit),
        id: `${unit.id}-${n}`,
        kind: entry.k,
        statement: entry.t,
        confidence: entry.c,
        refersToDemonstration: entry.d === 1 || entry.d === true,
        extractor: "apprentice_model",
      }),
    );
  }
  return out.sort((a, b) => (a.startMs ?? 0) - (b.startMs ?? 0));
}

export async function extractStatements(units: TeachingUnit[], model: SemanticModel | null): Promise<TeachingStatement[]> {
  if (units.length === 0) return [];
  if (!model) return fallbackStatements(units);
  try {
    const raw = await model.extract(
      units.map((u, i) => ({ i, text: u.text, startMs: u.startMs, endMs: u.endMs, question: u.questionText })),
    );
    const statements = statementsFromModel(units, raw);
    DebugBus.emit({
      category: "AI",
      event: "STATEMENTS_EXTRACTED",
      data: { units: units.length, statements: statements.length, source: units[0]?.source },
    });
    return statements;
  } catch (error) {
    DebugBus.emit({
      category: "AI",
      level: "warn",
      event: "STATEMENT_EXTRACTION_FALLBACK",
      message: error instanceof Error ? error.message : "Extraction failed",
    });
    return fallbackStatements(units);
  }
}

function contextFor(statement: TeachingStatement | undefined, analysis: SessionAnalysis): string | undefined {
  if (!statement) return undefined;
  const statements = analysis.statements ?? [];
  const units = [...new Set(statements.map((s) => s.unitId))];
  const index = units.indexOf(statement.unitId);
  const nearby = units.slice(Math.max(0, index - 1), index + 2);
  const texts = nearby
    .map((unitId) => statements.find((s) => s.unitId === unitId)?.sourceText)
    .filter((t): t is string => Boolean(t));
  return quote(texts.join(" "), 600);
}

async function phraseAll(
  model: SemanticModel | null,
  phase: "capture_review" | "debrief",
  gaps: PhraseGap[],
  context: PhraseContext,
): Promise<Map<number, string> | null> {
  if (!model || gaps.length === 0) return null;
  try {
    const parsed = QuestionPhrasingResponseSchema.parse(await model.phrase(phase, gaps, context));
    return new Map(parsed.q.map((q) => [q.g, q.t.trim()]));
  } catch (error) {
    DebugBus.emit({
      category: "AI",
      level: "warn",
      event: "QUESTION_PHRASING_FALLBACK",
      message: error instanceof Error ? error.message : "Phrasing failed",
    });
    return null;
  }
}

const normalize = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Capture Review: deterministic gaps, model-phrased questions.
 * The model may omit a gap it judges already answered by the transcript; the
 * failure (guardrail) gap is never dropped.
 */
export async function buildCaptureReview(
  analysis: SessionAnalysis,
  config: RuntimeConfig,
  maxQuestions: number,
  model: SemanticModel | null,
  skillName?: string,
): Promise<QuestionCandidate[]> {
  const max = Math.max(3, maxQuestions);
  const all = findKnowledgeGaps(analysis, config);
  const pool = selectGaps(all, max + 3);
  const statements = new Map((analysis.statements ?? []).map((s) => [s.id, s]));
  const phraseInput: PhraseGap[] = pool.map((gap, g) => {
    const s = gap.statementId ? statements.get(gap.statementId) : undefined;
    return {
      g,
      type: gap.type,
      quote: s ? quote(s.sourceText, 300) : undefined,
      context: contextFor(s, analysis),
      observed: gap.evidence.slice(0, 2).map((e) => e.description).join("; ") || undefined,
    };
  });
  const phrased = await phraseAll(model, "capture_review", phraseInput, {
    skill: skillName,
    known: knownPoints(analysis),
  });

  const questions: QuestionCandidate[] = [];
  const asked = new Set<string>();
  const byPriority = pool.map((gap, g) => ({ gap, g })).sort((a, b) => b.gap.priority - a.gap.priority);
  for (const { gap, g } of byPriority) {
    if (questions.length >= max) break;
    const statement = gap.statementId ? statements.get(gap.statementId) : undefined;
    let text = phrased ? phrased.get(g) : fallbackGapQuestion(gap, statement);
    if (!text && gap.type === "failure") text = fallbackGapQuestion(gap, statement);
    if (!text || asked.has(normalize(text))) continue;
    asked.add(normalize(text));
    questions.push(QuestionCandidateSchema.parse(gapToCaptureQuestion(gap, text, phrased ? 0.8 : 0.6)));
  }
  questions.sort((a, b) => (a.timestampMs ?? 0) - (b.timestampMs ?? 0));
  DebugBus.emit({
    category: "AI",
    event: "CAPTURE_REVIEW_READY",
    data: {
      gaps: all.length,
      asked: questions.length,
      phrasedBy: phrased ? "apprentice_model" : "offline_fallback",
      types: questions.map((q) => q.gapType),
    },
  });
  return questions;
}

function leftoverGaps(analysis: SessionAnalysis, config: RuntimeConfig, answered: QuestionCandidate[]): KnowledgeGap[] {
  const asked = new Set(answered.map((q) => `${q.gapType ?? ""}:${q.statementId ?? ""}`));
  return selectGaps(findKnowledgeGaps(analysis, config), 12).filter(
    (g) => g.type !== "failure" && !asked.has(`${g.type}:${g.statementId ?? ""}`),
  );
}

/** Debrief: at least three follow-ups grounded in the expert's answers and remaining gaps. */
export async function buildDebrief(
  answered: QuestionCandidate[],
  analysis: SessionAnalysis,
  config: RuntimeConfig,
  model: SemanticModel | null,
  maxQuestions = 4,
  skillName?: string,
): Promise<QuestionCandidate[]> {
  const candidates: DebriefGap[] = findDebriefGaps(answered, analysis, leftoverGaps(analysis, config, answered)).slice(
    0,
    maxQuestions + 3,
  );
  const phrased = await phraseAll(
    model,
    "debrief",
    candidates.map((gap, g) => ({
      g,
      type: gap.type,
      quote: gap.statement ? quote(gap.statement.sourceText, 300) : gap.options?.map((o) => quote(o, 80)).join(" | "),
      answer: gap.sourceQuestion?.answer ? quote(gap.sourceQuestion.answer, 600) : undefined,
      context: gap.sourceQuestion ? quote(gap.sourceQuestion.question, 300) : contextFor(gap.statement, analysis),
    })),
    {
      skill: skillName,
      known: knownPoints(
        analysis,
        answered.flatMap((q) => (q.status === "answered" && q.answer ? [q.answer] : [])),
      ),
    },
  );
  const previous = new Set(answered.map((q) => normalize(q.question)));
  const out: QuestionCandidate[] = [];
  candidates.forEach((gap, g) => {
    if (out.length >= Math.max(3, maxQuestions)) return;
    const text = phrased?.get(g) ?? fallbackDebriefQuestion(gap);
    if (previous.has(normalize(text))) return;
    previous.add(normalize(text));
    out.push(QuestionCandidateSchema.parse(debriefGapToQuestion(gap, text, phrased ? 0.75 : 0.55)));
  });
  DebugBus.emit({
    category: "AI",
    event: "DEBRIEF_READY",
    data: { count: out.length, phrasedBy: phrased ? "apprentice_model" : "offline_fallback" },
  });
  return out;
}

/** Offline teach-back: the expert's answers first (they are the distilled points), then narration counts. */
export function fallbackTeachBack(items: TeachBackItem[]): string {
  const keep = items.filter((i) => i.status !== "rejected");
  const text = (i: TeachBackItem) => i.correctedText ?? i.text;
  const answers = keep.filter((i) => i.kind !== "warning" && i.provenance.sourceClass !== "EXPLICIT_TEACHING");
  const warnings = keep.filter((i) => i.kind === "warning");
  const narrated = keep.filter((i) => i.kind !== "warning" && i.provenance.sourceClass === "EXPLICIT_TEACHING");
  return [
    "Here is what I learned from you:",
    ...answers.map((i) => `- ${text(i)}`),
    ...(warnings.length ? ["What to avoid:", ...warnings.map((i) => `- ${text(i)}`)] : []),
    ...(narrated.length ? [`Plus ${narrated.length} points from your narration, listed below.`] : []),
  ].join("\n");
}

export async function buildTeachBack(
  items: TeachBackItem[],
  model: SemanticModel | null,
  skillName?: string,
): Promise<string> {
  const keep = items.filter((i) => i.status !== "rejected");
  if (!model || keep.length === 0) return fallbackTeachBack(items);
  try {
    const parsed = TeachBackResponseSchema.parse(
      await model.summarize(
        keep.map((item, i) => ({ i, kind: item.kind, text: item.correctedText ?? item.text })),
        skillName,
      ),
    );
    return parsed.summary;
  } catch (error) {
    DebugBus.emit({
      category: "AI",
      level: "warn",
      event: "TEACHBACK_FALLBACK",
      message: error instanceof Error ? error.message : "Teach-back failed",
    });
    return fallbackTeachBack(items);
  }
}

const PREP_KNOWLEDGE_LIMIT = 16;
const PREP_GUARDRAIL_LIMIT = 6;

export function fallbackLearnPreparation(lesson: Lesson): LearnPreparation {
  return {
    predictionQuestion: `Before your first attempt at ${lesson.name}: which part of the movement do you expect to be hardest, and why?`,
    cues: {},
    preparedBy: "offline_fallback",
  };
}

/**
 * Learn preparation: one model call before practice for the prediction
 * question and a corrective cue per movement phase, grounded only in the
 * lesson's confirmed knowledge and guardrails.
 */
export async function buildLearnPreparation(lesson: Lesson, model: SemanticModel | null): Promise<LearnPreparation> {
  const knowledge = [...lesson.knowledge]
    .sort((a, b) => b.importance - a.importance)
    .slice(0, PREP_KNOWLEDGE_LIMIT)
    .map((k) => ({ kind: k.kind, text: quote(k.statement, 220) }));
  const guardrails = lesson.guardrails.slice(0, PREP_GUARDRAIL_LIMIT).map((g) => quote(g.statement, 220));
  if (!model || knowledge.length + guardrails.length === 0) return fallbackLearnPreparation(lesson);
  try {
    const parsed = LearnPreparationResponseSchema.parse(
      await model.prepare({ skill: quote(lesson.name, 120), knowledge, guardrails }),
    );
    const cues: LearnPreparation["cues"] = {};
    for (const cue of parsed.c) cues[cue.ph] ??= cue.t.trim();
    DebugBus.emit({ category: "AI", event: "LEARN_PREPARED", data: { phases: Object.keys(cues) } });
    return { predictionQuestion: parsed.p.trim(), cues, preparedBy: "apprentice_model" };
  } catch (error) {
    DebugBus.emit({
      category: "AI",
      level: "warn",
      event: "LEARN_PREPARATION_FALLBACK",
      message: error instanceof Error ? error.message : "Learn preparation failed",
    });
    return fallbackLearnPreparation(lesson);
  }
}
