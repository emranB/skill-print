/** Historical adapter retained for diagnostics. Neither new nor compatibility Learn imports this. */
import { movementRequest } from "../pose/RTMW3DPoseDetector";
import { buildRuntimeTargets, type RuntimeTarget } from "../lesson/RuntimeTargets";
import type { CanonicalMovement, MovementAlignmentReply, NormalizedPose, PoseFrame } from "../pose/pose.types";
import type { ProgressTrackerEvent, ProgressTrackerOptions } from "./ProgressTracker";

export class DTWProgressTracker {
  readonly targets: RuntimeTarget[];
  private ready: Promise<unknown> | null = null;
  private closed = false;
  private finished = false;
  private result: MovementAlignmentReply | null = null;
  private boundStreamId: string | undefined;
  private lastProgress = 0;
  lastSimilarity = 0;

  constructor(readonly canonical: CanonicalMovement, private readonly options: ProgressTrackerOptions,
    private readonly runId: string, private readonly difficulty: number) {
    this.targets = buildRuntimeTargets(canonical, difficulty);
  }

  async update(pose: NormalizedPose, streamId?: string, alignment?: PoseFrame["alignment"]): Promise<ProgressTrackerEvent | null> {
    if (this.closed || this.finished) return null;
    if (!pose.bodySkeleton) throw new Error("This lesson requires RTMW3D extraction; legacy landmarks cannot be matched as 3D");
    if (!this.ready) {
      this.boundStreamId = streamId;
      this.ready = movementRequest({ operation: "start", runId: this.runId, streamId, canonical: this.canonical, difficulty: this.difficulty, leniency: this.options.leniency });
    }
    await this.ready;
    if (this.closed) return null;
    if (streamId && streamId !== this.boundStreamId) {
      await movementRequest({ operation: "bind", runId: this.runId, streamId });
      this.boundStreamId = streamId;
    }
    const result = alignment?.runId === this.runId && alignment.timestampMs === pose.timestampMs
      ? alignment.result
      : await movementRequest<MovementAlignmentReply>({ operation: "align", runId: this.runId, pose: { timestampMs: pose.timestampMs, bodySkeleton: pose.bodySkeleton } });
    if (this.closed) return null;
    this.result = result;
    this.lastSimilarity = result.similarity;
    const reference = this.canonical.references!.find((r) => r.demonstrationId === result.referenceId)!;
    const runtime = buildRuntimeTargets({ ...this.canonical, samples: reference.samples, anchors: reference.anchors }, this.difficulty);
    this.targets.splice(0, this.targets.length, ...runtime);
    if (result.event) {
      this.finished = result.event === "SEQUENCE_COMPLETE";
      this.lastProgress = 0;
      return { type: result.event };
    }
    if (result.currentProgressPercent > this.lastProgress) {
      this.lastProgress = result.currentProgressPercent;
      return { type: "CHECKPOINT_PASSED", index: this.getExpectedIndex(), progress: this.lastProgress, phase: result.currentPhase };
    }
    return result.usable && result.reason !== "tracking_invalid" && result.similarity >= 1 - this.options.leniency ? null : { type: "MISMATCH", index: this.getExpectedIndex(), similarity: result.similarity };
  }

  getExpectedIndex() {
    return Math.max(0, this.targets.findIndex((t) => t.progress01 >= (this.result?.currentProgressPercent ?? 0) / 100 - 1e-8));
  }
  getGhostTarget() { return this.result?.alignedSample ?? this.targets[0]; }
  diagnostics() {
    return { furthestProgressPercent: this.result?.furthestProgressPercent ?? 0, currentPhase: this.result?.currentPhase ?? this.targets[0]?.phase,
      lastSatisfiedAnchor: this.result?.lastSatisfiedAnchor ?? null, runtimeTargetIndex: this.getExpectedIndex(),
      runtimeTargetCount: this.targets.length, currentProgressPercent: this.result?.currentProgressPercent ?? 0,
      reason: this.result?.reason ?? "awaiting_start", referenceId: this.result?.referenceId,
      normalizedDtwDistance: this.result?.normalizedDtwDistance, alignmentMs: this.result?.alignmentMs };
  }
  finish() {
    this.closed = true;
    if (this.ready) void this.ready.then(() => movementRequest({ operation: "finish", runId: this.runId })).catch(() => undefined);
    return this.finished ? "sequence_complete" : this.result?.lastSatisfiedAnchor === "apex" ? "incomplete_return" : this.canonical.kind === "sequence" ? "incomplete_sequence" : "never_reached_apex";
  }
}
