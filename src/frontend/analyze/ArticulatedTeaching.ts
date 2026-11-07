import { usableArticulated } from "../../shared/movement/ArticulatedBody";
import { heavyBody } from "../../shared/movement/HeavyBody";
import { createId } from "../../shared/utils/id";
import { normalizePose } from "../pose/PoseNormalizer";
import type { Demonstration, MovementKind, PoseFrame } from "../pose/pose.types";
import { heavyCycles } from "./HeavySegmentation";

/** A teacher-recorded execution does not depend on automatic multi-cycle segmentation. */
export function singleArticulatedExecution(
  frames: PoseFrame[],
  kind: MovementKind,
): Demonstration[] {
  const path = frames.filter((f) => usableArticulated(f.articulated3d)).map(normalizePose);
  return path.length < 3
    ? []
    : [
        {
          id: createId(),
          kind,
          startMs: path[0]!.timestampMs,
          endMs: path.at(-1)!.timestampMs,
          classification: "unknown",
          teacherConfirmed: false,
          trajectory: path,
        },
      ];
}

/** Optional existing upload proposal convenience, isolated from representation and matching. */
export function articulatedProposals(frames: PoseFrame[]) {
  const byTime = new Map(frames.map((f) => [f.timestampMs, normalizePose(f)]));
  const proposalFrames = frames.map((f) => ({
    ...f,
    body3d: heavyBody(f.worldLandmarks, f.landmarks),
  }));
  const result = heavyCycles(proposalFrames);
  const demonstrations = result.demonstrations.map((d) => ({
    ...d,
    trajectory: d.trajectory.map((p) => byTime.get(p.timestampMs)!),
  }));
  if (!demonstrations.some((d) => d.classification !== "fragment")) {
    return { ...result, demonstrations: singleArticulatedExecution(frames, "cycle") };
  }
  return { ...result, demonstrations };
}
