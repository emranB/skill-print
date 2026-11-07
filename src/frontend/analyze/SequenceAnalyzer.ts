import { createId } from "../../shared/utils/id";
import { normalizePose } from "../pose/PoseNormalizer";
import { poseDistance } from "../pose/PoseDistance";
import { isUsablePose, usabilityFloor } from "../pose/PoseUsability";
import type { Demonstration, PoseFrame } from "../pose/pose.types";
import { heavySequence } from "./HeavySegmentation";
import { singleArticulatedExecution } from "./ArticulatedTeaching";

export const SEQUENCE_STABLE_MS = 500;
export const SEQUENCE_STABLE_DISTANCE = 0.08;

/** Start at the first consecutive stable window; end at a terminal pause or EOF. */
export function detectSequence(frames: PoseFrame[], minimumVisibility = 0.65): Demonstration[] {
  if(frames.some(f => f.articulated3d)) return singleArticulatedExecution(frames,"sequence");
  if (frames.some(f => f.body3d)) return heavySequence(frames);
  const floor = usabilityFloor(minimumVisibility);
  let stableStart = -1;
  let start = -1;
  for (let i = 0; i < frames.length; i += 1) {
    const frame = frames[i]!;
    if (!isUsablePose(frame.landmarks, floor)) { stableStart = -1; continue; }
    if (stableStart < 0 || (i > 0 && frame.timestampMs - frames[i - 1]!.timestampMs > 250)) stableStart = i;
    const distance = poseDistance(normalizePose(frame), normalizePose(frames[stableStart]!), { planar: true, minimumVisibility: floor, minimumJoints: 6 });
    if (distance > SEQUENCE_STABLE_DISTANCE) stableStart = i;
    if (frame.timestampMs - frames[stableStart]!.timestampMs >= SEQUENCE_STABLE_MS) { start = stableStart; break; }
  }
  if (start < 0) return [];
  const usable = frames.slice(start).filter((f) => isUsablePose(f.landmarks, floor));
  if (usable.length < 2) return [];
  // Only the final contiguous dwell is terminal; pauses inside a sequence remain part of its path.
  let end = usable.length - 1;
  const last = normalizePose(usable[end]!);
  let terminalStart = end;
  while (terminalStart > 0 && usable[terminalStart]!.timestampMs - usable[terminalStart - 1]!.timestampMs <= 250 && poseDistance(normalizePose(usable[terminalStart - 1]!), last,
    { planar: true, minimumVisibility: floor, minimumJoints: 6 }) <= SEQUENCE_STABLE_DISTANCE) terminalStart -= 1;
  if (usable[end]!.timestampMs - usable[terminalStart]!.timestampMs >= SEQUENCE_STABLE_MS) {
    end = Math.max(terminalStart, usable.findIndex((f) => f.timestampMs >= usable[terminalStart]!.timestampMs + SEQUENCE_STABLE_MS));
  }
  const path = usable.slice(0, end + 1);
  return [{ id: createId(), kind: "sequence", startMs: path[0]!.timestampMs, endMs: path[path.length - 1]!.timestampMs,
    classification: "unknown", teacherConfirmed: false, trajectory: path.map((f) => normalizePose(f)) }];
}
