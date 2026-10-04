import { createId } from "../../shared/utils/id";
import type { PoseFrame, PoseRecording } from "../pose/pose.types";

interface RawPoseFixture {
  schemaVersion: number;
  frames: PoseFrame[];
  id?: string;
  sessionId?: string;
}

export async function loadPoseFixture(url: string, sessionId: string): Promise<PoseRecording> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load pose fixture: ${url}`);
  }
  const raw = (await response.json()) as RawPoseFixture;
  if (!raw.frames || !Array.isArray(raw.frames)) {
    throw new Error(`Invalid pose fixture at ${url}`);
  }
  return {
    schemaVersion: 1,
    id: raw.id ?? createId(),
    sessionId: raw.sessionId ?? sessionId,
    frames: raw.frames,
  };
}

export const FIXTURE_TEACHER_POSE = "/fixtures/motion-cycle-a/teacher.pose.json";
export const FIXTURE_STUDENT_GOOD = "/fixtures/motion-cycle-a/student-good.pose.json";
export const FIXTURE_STUDENT_BAD = "/fixtures/motion-cycle-a/student-bad.pose.json";
