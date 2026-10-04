import { createId } from "../../shared/utils/id";
import { DebugBus } from "../debug/DebugBus";
import type { BodyCalibration, Demonstration, Guardrail, KnowledgeItem, NormalizedPose } from "../pose/pose.types";
import type { QuestionCandidate } from "../analyze/analyze.types";
import { discoverRequiredLandmarks } from "../analyze/GeometrySummarizer";
import { buildCanonicalMovement } from "./CanonicalMovementBuilder";
import type { Lesson } from "./lesson.types";
import type { TeachBackItem } from "./TeachBackItems";

export interface CompileLessonInput {
  name: string;
  importantThings?: string;
  sourceSessionId: string;
  teacherCalibration: BodyCalibration;
  referencePose: NormalizedPose;
  demonstrations: Demonstration[];
  questions: QuestionCandidate[];
  /** Expert-reviewed knowledge. When present it is the only knowledge source. */
  teachBackItems?: TeachBackItem[];
}

const IMPORTANCE: Record<string, number> = {
  emphasis: 1,
  target: 1,
  warning: 1,
  technique: 0.85,
  instruction: 0.85,
  sequencing: 0.7,
  reason: 0.7,
  modification: 0.6,
  exception: 0.6,
  progression: 0.6,
  prescription: 0.6,
  unknown: 0.5,
};

function fromTeachBack(items: TeachBackItem[]): { knowledge: KnowledgeItem[]; guardrails: Guardrail[] } {
  const knowledge: KnowledgeItem[] = [];
  const guardrails: Guardrail[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (item.status !== "confirmed" && item.status !== "corrected") continue;
    const corrected = item.status === "corrected" && item.correctedText?.trim();
    const statement = corrected ? item.correctedText!.trim() : item.text;
    const provenance = corrected
      ? { ...item.provenance, sourceClass: "CONFIRMED_TEACH_BACK" as const, correctedFrom: item.text }
      : item.provenance;
    const key = [
      provenance.sourceClass,
      provenance.transcriptStartMs ?? "",
      statement.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    const reason =
      provenance.sourceClass === "EXPERT_ANSWER" || provenance.correctedFrom
        ? provenance.questionText
        : undefined;
    if (item.kind === "warning") {
      guardrails.push({ id: createId(), statement, reason, teacherConfirmed: true, provenance });
    } else {
      knowledge.push({
        id: createId(),
        kind: item.kind,
        statement,
        reason,
        importance: IMPORTANCE[item.kind] ?? 0.5,
        teacherConfirmed: true,
        provenance,
      });
    }
  }
  return { knowledge, guardrails };
}

function fromAnsweredQuestions(questions: QuestionCandidate[]): {
  knowledge: KnowledgeItem[];
  guardrails: Guardrail[];
} {
  const knowledge: KnowledgeItem[] = [];
  const guardrails: Guardrail[] = [];
  for (const q of questions) {
    if (q.status !== "answered" || !q.answer) continue;
    const provenance = {
      sourceClass: "EXPERT_ANSWER" as const,
      questionId: q.id,
      questionText: q.question,
      expertAnswer: q.answer,
      startMs: q.clipStartMs ?? q.timestampMs,
      endMs: q.clipEndMs ?? q.timestampMs,
      simulated: q.simulatedAnswer || undefined,
    };
    if (q.type === "guardrail") {
      guardrails.push({ id: createId(), statement: q.answer, reason: q.question, teacherConfirmed: true, provenance });
    } else {
      knowledge.push({
        id: createId(),
        kind: "unknown",
        statement: q.answer,
        reason: q.question,
        importance: q.type === "importance" ? 1 : 0.7,
        teacherConfirmed: true,
        provenance,
      });
    }
  }
  return { knowledge, guardrails };
}

export function compileLesson(input: CompileLessonInput): Lesson {
  const canonicalMovement = buildCanonicalMovement(input.demonstrations);
  const { knowledge, guardrails } = input.teachBackItems?.length
    ? fromTeachBack(input.teachBackItems)
    : fromAnsweredQuestions(input.questions);
  const now = new Date().toISOString();
  const motionWindows = input.demonstrations.filter((d) => d.trajectory.length > 0);
  const requiredLandmarks = discoverRequiredLandmarks(
    motionWindows.flatMap((d) =>
      d.trajectory.map((p) => ({
        timestampMs: p.timestampMs,
        landmarks: p.landmarks,
        worldLandmarks: p.landmarks,
      })),
    ),
    motionWindows[0]?.startMs ?? 0,
    motionWindows[motionWindows.length - 1]?.endMs ?? 0,
  );

  const lesson: Lesson = {
    schemaVersion: 1,
    id: createId(),
    name: input.name,
    importantThings: input.importantThings,
    createdAt: now,
    updatedAt: now,
    teacherCalibration: input.teacherCalibration,
    referencePose: input.referencePose,
    demonstrations: input.demonstrations,
    canonicalMovement,
    knowledge,
    guardrails,
    trackingProfile: {
      requiredLandmarks,
      requiredFeatures: ["normalized_pose_similarity", "runtime_feature_magnitude"],
    },
    sourceSessionId: input.sourceSessionId,
  };

  DebugBus.emit({
    category: "LESSON",
    event: "LESSON_COMPILED",
    data: {
      id: lesson.id,
      name: lesson.name,
      checkpoints: lesson.canonicalMovement.checkpoints.length,
      knowledge: lesson.knowledge.length,
      guardrails: lesson.guardrails.length,
      sources: [...knowledge, ...guardrails].reduce<Record<string, number>>((acc, k) => {
        acc[k.provenance.sourceClass] = (acc[k.provenance.sourceClass] ?? 0) + 1;
        return acc;
      }, {}),
    },
  });

  return lesson;
}
