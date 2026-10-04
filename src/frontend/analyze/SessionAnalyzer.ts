import { DebugBus } from "../debug/DebugBus";
import { RuntimeConfigManager } from "../config/RuntimeConfig";
import { assertTeachingMedia, type TeachingMedia } from "../media/media.types";
import type { PoseRecording } from "../pose/pose.types";
import { detectCyclesWithDiagnostics } from "./CycleAnalyzer";
import { summarizeGeometryWindow } from "./GeometrySummarizer";
import { buildTimelineNotes } from "./TimelineAligner";
import { extractPoseRecordingFromVideoBlob } from "./VideoPoseExtractor";
import type {
  AnalyzeTeachingSessionContext,
  SessionAnalysis,
} from "./analyze.types";

async function extractPoseRecordingFromVideo(
  media: TeachingMedia,
  sessionId: string,
  onProgress?: (fraction: number) => void,
): Promise<PoseRecording> {
  if (!media.video) {
    throw new Error("Cannot extract poses without media.video");
  }

  const config = RuntimeConfigManager.get();
  const { poseRecording, stats } = await extractPoseRecordingFromVideoBlob(
    media.video,
    sessionId,
    {
      sampleFps: config.pose.sampleFps,
      minimumVisibility: config.pose.minimumVisibility,
      modelAssetPath: "/models/pose_landmarker_full.task",
      onProgress,
    },
  );

  DebugBus.emit({
    category: "ANALYSIS",
    event: "POSE_EXTRACTED_FROM_VIDEO",
    data: stats,
  });

  return poseRecording;
}

/**
 * Sole production analysis entrypoint (deterministic geometry only).
 * Uses media.poseRecording if present; otherwise extracts from video.
 * Semantic extraction happens afterwards through the apprentice gateway.
 */
export async function analyzeTeachingSession(
  media: TeachingMedia,
  context: AnalyzeTeachingSessionContext,
): Promise<SessionAnalysis> {
  assertTeachingMedia(media);
  DebugBus.emit({
    category: "ANALYSIS",
    event: "ANALYZE_START",
    data: {
      source: media.source,
      hasPose: Boolean(media.poseRecording),
      hasVideo: Boolean(media.video),
      sessionId: context.sessionId,
    },
  });

  let poseRecording = media.poseRecording;
  if (!poseRecording || (poseRecording.frames.length === 0 && media.video)) {
    if (!media.video) {
      throw new Error("TeachingMedia invalid: need video or poseRecording");
    }
    poseRecording = await extractPoseRecordingFromVideo(media, context.sessionId, context.onPoseProgress);
  }

  if (poseRecording.frames.length === 0) {
    throw new Error("PoseRecording is empty after extraction");
  }

  const frames = poseRecording.frames;
  const minimumVisibility = context.configSnapshot.config.pose.minimumVisibility;
  const { demonstrations, diagnostics } = detectCyclesWithDiagnostics(frames, context.referencePose, {
    minimumVisibility,
  });

  const observations = demonstrations.flatMap((demo) =>
    summarizeGeometryWindow(frames, demo.startMs, demo.endMs, { apexMs: demo.apexMs }),
  );

  const timelineNotes = buildTimelineNotes(
    context.transcript,
    demonstrations.map((d, i) => ({
      startMs: d.startMs,
      endMs: d.endMs,
      label: `demonstration_${i + 1}`,
    })),
  );

  const analysis: SessionAnalysis = {
    sessionId: context.sessionId,
    poseRecording,
    demonstrations,
    observations,
    timelineNotes,
    segmentation: diagnostics,
    transcript: context.transcript,
  };

  DebugBus.emit({
    category: "ANALYSIS",
    event: "ANALYZE_COMPLETE",
    data: {
      demonstrationCount: demonstrations.length,
      observationCount: observations.length,
      frameCount: frames.length,
      timelineNoteCount: timelineNotes.length,
      segmentation: diagnostics,
    },
  });

  return analysis;
}
