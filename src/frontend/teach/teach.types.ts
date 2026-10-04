import type { BodyCalibration, NormalizedPose } from "../pose/pose.types";
import type { TeachingMedia } from "../media/media.types";
import type { LiveInterviewResult } from "../apprentice/LiveInterview";

export interface TeachingSession {
  schemaVersion: 1;
  id: string;
  createdAt: string;
  /** Poses live only on media after analysis attaches them. */
  media?: TeachingMedia;
  calibration?: BodyCalibration;
  referencePose?: NormalizedPose;
  lessonName?: string;
  importantThings?: string;
  /** Spoken clarifying questions and replies captured while recording live. */
  liveInterview?: LiveInterviewResult;
}
