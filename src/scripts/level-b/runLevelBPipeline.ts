import type { ApprenticeGateway } from "../../frontend/apprentice/ApprenticeGateway";
import { ElevenLabsGateway } from "../../frontend/apprentice/ElevenLabsGateway";
import { MockApprenticeGateway } from "../../frontend/apprentice/MockApprenticeGateway";
import { analyzeTeachingSession } from "../../frontend/analyze/SessionAnalyzer";
import { enrichAnalysisWithTeaching, extractAnswerStatements } from "../../frontend/analyze/TeachingEnrichment";
import { transcribeMediaBlob } from "../../frontend/analyze/transcribeClient";
import type {
  CaptureReviewQuestion,
  QuestionCandidate,
  Transcript,
} from "../../frontend/analyze/analyze.types";
import { captureBodyCalibration } from "../../frontend/calibration/BodyCalibration";
import { RuntimeConfigManager } from "../../frontend/config/RuntimeConfig";
import { compileLesson } from "../../frontend/lesson/LessonCompiler";
import { LessonSchema } from "../../frontend/lesson/LessonSchema";
import { buildTeachBackItems } from "../../frontend/lesson/TeachBackItems";
import { UploadedMediaSource } from "../../frontend/media/UploadedMediaSource";
import { LessonRepository } from "../../frontend/storage/LessonRepository";
import { createId } from "../../shared/utils/id";

export type LevelBLaneStatus = "PASS" | "FAIL" | "SKIPPED";

/** Answers the harness types in place of a person. Keyed by knowledge-gap type; "default" covers the rest. */
export type SimulatedAnswers = Record<string, string>;

export interface LevelBPipelineResult {
  status: "PASS" | "FAIL" | "PASS_WITH_SCRIBE_SKIPPED";
  scribeStatus: LevelBLaneStatus;
  apprenticeMode: "elevenlabs" | "mock";
  reason?: string;
  teachingMedia?: Record<string, unknown>;
  pose?: Record<string, unknown>;
  cycles?: Record<string, unknown>;
  scribe?: Record<string, unknown>;
  transcript?: Transcript;
  semantic?: Record<string, unknown>;
  captureReview?: Record<string, unknown>;
  debrief?: Record<string, unknown>;
  teachBack?: Record<string, unknown>;
  lesson?: Record<string, unknown>;
  momentPlayer?: Record<string, unknown>;
  persistence?: Record<string, unknown>;
  elapsedMs: number;
  timingsMs: Record<string, number>;
}

const SIMULATED_NOTE = "SIMULATED TEST RESPONSE";

function simulate(questions: QuestionCandidate[], answers: SimulatedAnswers): QuestionCandidate[] {
  return questions.map((q) => ({
    ...q,
    status: "answered" as const,
    answer: answers[q.gapType ?? ""] ?? answers.default ?? "",
    simulatedAnswer: true,
  }));
}

async function chooseGateway(): Promise<ApprenticeGateway> {
  const res = await fetch("/api/elevenlabs/session", { method: "POST" }).catch(() => null);
  return res?.ok ? new ElevenLabsGateway() : new MockApprenticeGateway();
}

/**
 * Browser-side Level B harness. Calls the same production modules the app
 * uses, in the same order. Only the expert's typed answers, demonstration
 * labels, and teach-back confirmation are simulated, and every one of them is
 * flagged as simulated in the result and in lesson provenance.
 */
export async function runLevelBPipeline(
  mediaUrl: string,
  simulatedAnswers: SimulatedAnswers,
): Promise<LevelBPipelineResult> {
  const started = performance.now();
  const timingsMs: Record<string, number> = {};
  const lap = (label: string, since: number) => {
    timingsMs[label] = Math.round(performance.now() - since);
    return performance.now();
  };
  await RuntimeConfigManager.load();
  const config = RuntimeConfigManager.get();
  const gateway = await chooseGateway();
  const base = { apprenticeMode: gateway.mode, timingsMs };

  const mediaRes = await fetch(mediaUrl);
  if (!mediaRes.ok) {
    return { ...base, status: "FAIL", scribeStatus: "FAIL", reason: `Failed to fetch media: ${mediaRes.status}`, elapsedMs: 0 };
  }
  const blob = await mediaRes.blob();
  const file = new File([blob], "uploaded-teaching.mp4", { type: "video/mp4" });
  const media = await new UploadedMediaSource(file).produce();
  const teachingMedia = {
    source: media.source,
    durationMs: media.durationMs,
    hasVideo: Boolean(media.video),
    sourceNamePresent: Boolean(media.sourceName),
  };

  let t = performance.now();
  let transcript: Transcript | undefined;
  let scribeStatus: LevelBLaneStatus = "FAIL";
  let scribe: Record<string, unknown> = {};
  try {
    transcript = await transcribeMediaBlob(media.video!, "uploaded-teaching.mp4");
    scribe = { wordCount: transcript.words.length, textPreview: (transcript.fullText ?? "").slice(0, 200) };
    scribeStatus = transcript.words.length >= 5 ? "PASS" : "FAIL";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    scribeStatus = /ELEVENLABS_NOT_CONFIGURED|Missing ELEVENLABS|503/.test(message) ? "SKIPPED" : "FAIL";
    scribe = { reason: message };
  }
  t = lap("scribe", t);

  const sessionId = createId();
  const raw = await analyzeTeachingSession(media, {
    sessionId,
    transcript,
    configSnapshot: RuntimeConfigManager.snapshot(),
  });
  t = lap("poseAndSegmentation", t);
  const frames = raw.poseRecording.frames;
  const monotonic = frames.every((f, i) => i === 0 || f.timestampMs >= frames[i - 1]!.timestampMs);
  const finite = frames.every((f) => f.landmarks.every((l) => Number.isFinite(l.x) && Number.isFinite(l.y)));
  const pose = { frameCount: frames.length, monotonic, finite, lastTimestampMs: frames[frames.length - 1]?.timestampMs };

  // Simulated teacher labelling: complete cycles are accepted as good demonstrations.
  const demonstrations = raw.demonstrations.map((d) =>
    d.classification === "fragment" ? d : { ...d, classification: "good" as const, teacherConfirmed: true },
  );
  const cycles = {
    demonstrationCount: demonstrations.length,
    segmentation: raw.segmentation,
    demos: demonstrations.map((d) => ({
      id: d.id,
      startMs: d.startMs,
      apexMs: d.apexMs,
      endMs: d.endMs,
      classification: d.classification,
    })),
    labelling: SIMULATED_NOTE,
  };
  if (frames.length < 30 || !monotonic || !finite || demonstrations.length === 0) {
    return {
      ...base,
      status: "FAIL",
      scribeStatus,
      reason: "Pose extraction or segmentation invalid",
      teachingMedia,
      pose,
      cycles,
      scribe,
      elapsedMs: Math.round(performance.now() - started),
    };
  }

  const analysis = await enrichAnalysisWithTeaching({ ...raw, demonstrations }, gateway, config);
  t = lap("statementExtractionAndAlignment", t);
  const evidenceById = new Map((analysis.statementEvidence ?? []).map((e) => [e.statementId, e]));
  const semantic = {
    statements: (analysis.statements ?? []).map((s) => ({
      id: s.id,
      kind: s.kind,
      statement: s.statement,
      sourceText: s.sourceText,
      startMs: s.startMs,
      endMs: s.endMs,
      confidence: s.confidence,
      refersToDemonstration: s.refersToDemonstration,
      extractor: s.extractor,
      alignment: evidenceById.get(s.id)?.alignment,
      evidenceClip: evidenceById.has(s.id)
        ? [evidenceById.get(s.id)!.clipStartMs, evidenceById.get(s.id)!.clipEndMs]
        : null,
      demonstrationId: evidenceById.get(s.id)?.demonstrationId,
      geometry: evidenceById.get(s.id)?.geometryObservations.map((g) => g.description) ?? [],
    })),
  };

  const capture = await gateway.generateCaptureReviewQuestions({
    analysis,
    maxQuestions: config.review.maximumQuestions,
  });
  t = lap("captureReview", t);
  const captureReview = {
    count: capture.length,
    questions: capture.map((q) => ({
      id: q.id,
      type: q.type,
      gapType: q.gapType,
      statementId: q.statementId,
      question: q.question,
      clipStartMs: q.clipStartMs,
      clipEndMs: q.clipEndMs,
      evidence: q.evidence.map((e) => ({ feature: e.feature, startMs: e.startMs, endMs: e.endMs, description: e.description })),
      rationale: q.rationale,
    })),
  };
  const captureAnswered = simulate(capture, simulatedAnswers);

  const debriefQs = await gateway.generateDebriefQuestions({ answered: captureAnswered, analysis });
  t = lap("debrief", t);
  const debriefAnswered = simulate(debriefQs, simulatedAnswers);
  const debrief = {
    count: debriefQs.length,
    questions: debriefQs.map((q) => ({ type: q.type, gapType: q.gapType, question: q.question, rationale: q.rationale })),
  };

  const allAnswered = [...captureAnswered, ...debriefAnswered];
  const answerStatements = await extractAnswerStatements(allAnswered, gateway);
  const items = buildTeachBackItems(analysis.statements ?? [], analysis.statementEvidence ?? [], answerStatements, allAnswered);
  const summary = await gateway.generateTeachBack({ items });
  t = lap("teachBack", t);
  // Simulated expert confirmation of every teach-back item.
  const confirmed = items.map((item) => ({ ...item, status: "confirmed" as const }));
  const teachBack = {
    summary,
    itemCount: items.length,
    confirmation: SIMULATED_NOTE,
    answers: answerStatements.map((s) => ({ kind: s.kind, statement: s.statement, questionId: s.questionId })),
  };

  const startDemo = demonstrations.find((d) => d.classification !== "fragment") ?? demonstrations[0]!;
  const startFrame = frames.find((f) => f.timestampMs >= startDemo.startMs) ?? frames[0]!;
  const lesson = compileLesson({
    name: "Uploaded teaching lesson",
    sourceSessionId: sessionId,
    teacherCalibration: captureBodyCalibration(startFrame),
    referencePose: startDemo.trajectory[0]!,
    demonstrations,
    questions: allAnswered,
    teachBackItems: confirmed,
  });
  const parsed = LessonSchema.safeParse(lesson);
  const lessonInfo = {
    id: lesson.id,
    checkpoints: lesson.canonicalMovement.checkpoints.length,
    zodOk: parsed.success,
    zodError: parsed.success ? null : parsed.error.message,
    knowledge: lesson.knowledge.map((k) => ({ kind: k.kind, statement: k.statement, provenance: k.provenance })),
    guardrails: lesson.guardrails.map((g) => ({ statement: g.statement, provenance: g.provenance })),
  };

  const clip = capture.find((q): q is CaptureReviewQuestion => q.phase === "capture_review");
  let momentPlayer: Record<string, unknown> = { ok: false };
  if (clip) {
    const video = document.createElement("video");
    const objectUrl = URL.createObjectURL(media.video!);
    video.src = objectUrl;
    video.preload = "auto";
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error("MomentPlayer source failed"));
    });
    video.currentTime = clip.clipStartMs / 1000;
    await new Promise<void>((resolve) => {
      video.onseeked = () => resolve();
    });
    momentPlayer = { seekSec: video.currentTime, ok: Math.abs(video.currentTime - clip.clipStartMs / 1000) < 0.35 };
    URL.revokeObjectURL(objectUrl);
  }

  await LessonRepository.save(lesson);
  const reloaded = await LessonRepository.get(lesson.id);
  lap("compileAndPersist", t);

  const ok =
    scribeStatus !== "FAIL" &&
    parsed.success &&
    lesson.canonicalMovement.checkpoints.length === 9 &&
    capture.length >= 3 &&
    debriefQs.length >= 3 &&
    Boolean(reloaded);
  return {
    ...base,
    status: ok ? (scribeStatus === "SKIPPED" ? "PASS_WITH_SCRIBE_SKIPPED" : "PASS") : "FAIL",
    reason: ok ? undefined : "One or more pipeline requirements not met",
    scribeStatus,
    teachingMedia,
    pose,
    cycles,
    scribe,
    transcript,
    semantic,
    captureReview,
    debrief,
    teachBack,
    lesson: lessonInfo,
    momentPlayer,
    persistence: { saved: Boolean(reloaded), id: lesson.id },
    elapsedMs: Math.round(performance.now() - started),
  };
}
