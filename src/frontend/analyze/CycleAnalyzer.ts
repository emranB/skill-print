import { PoseSegmenter, type SegmentationEvent } from "../pose/PoseSegmenter";
import { normalizePose } from "../pose/PoseNormalizer";
import { poseDistance } from "../pose/PoseDistance";
import type { Demonstration, Landmark, NormalizedPose, PoseFrame } from "../pose/pose.types";
import { isUsablePose, usabilityFloor } from "../pose/PoseUsability";
import type { SegmentationSummary } from "./analyze.types";

export interface CycleDetectionOptions {
  minimumVisibility?: number;
}

interface Tuning {
  smoothRadius: number;
  stableSpeed: number;
  stableMinMs: number;
  clusterRadius: number;
  /** An absence from rest longer than this is a stance or viewpoint change, not a cycle. */
  maxCycleMs: number;
  minRegimeRestDistance: number;
  minAmplitude: number;
}

const TUNING: Tuning = {
  smoothRadius: 2,
  stableSpeed: 0.5,
  stableMinMs: 500,
  clusterRadius: 0.25,
  maxCycleMs: 12_000,
  minRegimeRestDistance: 0.3,
  minAmplitude: 0.25,
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))))]!;
}

/** Per-landmark temporal median filter; suppresses single-frame detector jitter. */
function smoothFrames(frames: PoseFrame[], radius: number): PoseFrame[] {
  return frames.map((frame, i) => {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(frames.length - 1, i + radius);
    const landmarks: Landmark[] = frame.landmarks.map((_, j) => {
      const xs: number[] = [];
      const ys: number[] = [];
      const zs: number[] = [];
      const vs: number[] = [];
      for (let k = lo; k <= hi; k += 1) {
        const lm = frames[k]!.landmarks[j];
        if (!lm) continue;
        xs.push(lm.x);
        ys.push(lm.y);
        zs.push(lm.z);
        vs.push(lm.visibility ?? 0);
      }
      return { x: median(xs), y: median(ys), z: median(zs), visibility: median(vs) };
    });
    return { timestampMs: frame.timestampMs, landmarks, worldLandmarks: frame.worldLandmarks };
  });
}

interface StableRun {
  start: number;
  end: number;
  medoid: NormalizedPose;
  dwellMs: number;
}

interface Cluster {
  pose: NormalizedPose;
  dwellMs: number;
  runs: StableRun[];
}

/**
 * Offline rest-anchored segmentation over a whole recording.
 *
 * 1. Image-plane distances on median-smoothed poses (monocular depth is too noisy).
 * 2. Stable runs (low pose speed) are clustered; the rest pose is the cluster
 *    the performer dwells in longest. No posture (standing, lying, seated) is assumed,
 *    and the recording may begin mid-movement.
 * 3. An absence from rest longer than maxCycleMs is a new regime (camera angle or
 *    stance changed). Its local rest is the stable cluster inside it that best
 *    resembles the global rest.
 * 4. Thresholds adapt per regime from that regime's own baseline and amplitude,
 *    then the shared PoseSegmenter state machine extracts cycles.
 * 5. An excursion already in progress at a regime start, or still open at its end,
 *    is a fragment, never a complete cycle.
 */
export function detectCyclesWithDiagnostics(
  frames: PoseFrame[],
  referencePose?: NormalizedPose,
  options?: CycleDetectionOptions,
): { demonstrations: Demonstration[]; diagnostics: SegmentationSummary } {
  const floor = usabilityFloor(options?.minimumVisibility);
  const empty: SegmentationSummary = {
    usableFrames: 0,
    skippedLowVisibility: frames.length,
    restSource: "fallback_first_frames",
    restDwellMs: 0,
    regimes: [],
    completeCycles: 0,
    fragmentCycles: 0,
  };
  const usableRaw = frames.filter((f) => isUsablePose(f.landmarks, floor));
  if (usableRaw.length < 3) return { demonstrations: [], diagnostics: empty };

  const usable = smoothFrames(usableRaw, TUNING.smoothRadius);
  const poses = usable.map((f) => normalizePose(f));
  const times = poses.map((p) => p.timestampMs);
  const dist = (a: NormalizedPose, b: NormalizedPose) =>
    poseDistance(a, b, { minimumVisibility: floor, planar: true, minimumJoints: 4 });

  const rawSpeed = poses.map((p, i) => {
    if (i === 0) return 0;
    const d = dist(p, poses[i - 1]!);
    const dt = Math.max(1e-3, (p.timestampMs - poses[i - 1]!.timestampMs) / 1000);
    return Number.isFinite(d) ? d / dt : Number.POSITIVE_INFINITY;
  });
  const speed = rawSpeed.map((_, i) =>
    median(rawSpeed.slice(Math.max(0, i - 3), Math.min(rawSpeed.length, i + 4)).map((v) => (Number.isFinite(v) ? v : 99))),
  );

  const stableRuns = (from: number, to: number): StableRun[] => {
    const runs: StableRun[] = [];
    let start: number | null = null;
    const close = (end: number) => {
      if (start === null) return;
      const dwellMs = times[end]! - times[start]!;
      if (dwellMs >= TUNING.stableMinMs) {
        runs.push({ start, end, dwellMs, medoid: poses[Math.floor((start + end) / 2)]! });
      }
      start = null;
    };
    for (let i = from; i <= to; i += 1) {
      if (speed[i]! < TUNING.stableSpeed) {
        if (start === null) start = i;
      } else {
        close(i - 1);
      }
    }
    close(to);
    return runs;
  };

  const clusterRuns = (runs: StableRun[]): Cluster[] => {
    const clusters: Cluster[] = [];
    for (const run of runs) {
      const match = clusters.find((c) => dist(run.medoid, c.pose) < TUNING.clusterRadius);
      if (match) {
        match.dwellMs += run.dwellMs;
        match.runs.push(run);
      } else {
        clusters.push({ pose: run.medoid, dwellMs: run.dwellMs, runs: [run] });
      }
    }
    return clusters;
  };

  let rest: NormalizedPose;
  let restSource: SegmentationSummary["restSource"];
  let restDwellMs = 0;
  const globalClusters = clusterRuns(stableRuns(0, poses.length - 1));
  if (referencePose) {
    rest = referencePose;
    restSource = "supplied";
  } else if (globalClusters.length > 0) {
    const best = globalClusters.reduce((a, b) => (b.dwellMs > a.dwellMs ? b : a));
    rest = best.pose;
    restDwellMs = best.dwellMs;
    restSource = "stable_dwell";
  } else {
    rest = poses[0]!;
    restSource = "fallback_first_frames";
  }

  const toRest = poses.map((p) => dist(p, rest));
  const restNoise = globalClusters.length
    ? median(
        globalClusters
          .filter((c) => dist(c.pose, rest) < TUNING.clusterRadius)
          .flatMap((c) => c.runs.flatMap((r) => toRest.slice(r.start, r.end + 1)))
          .filter(Number.isFinite),
      )
    : 0;
  const nearRest = Math.max(0.15, restNoise * 2);

  // Regime boundaries: long absences from the global rest.
  type Regime = { from: number; to: number; rest: NormalizedPose };
  const regimes: Regime[] = [];
  let cursor = 0;
  let i = 0;
  while (i < poses.length) {
    if (toRest[i]! > nearRest) {
      let j = i;
      while (j < poses.length && toRest[j]! > nearRest) j += 1;
      const end = j - 1;
      if (times[end]! - times[i]! > TUNING.maxCycleMs) {
        const candidates = clusterRuns(stableRuns(i, end)).filter(
          (c) => dist(c.pose, rest) > TUNING.minRegimeRestDistance,
        );
        if (candidates.length > 0) {
          const local = candidates.reduce((a, b) => (dist(b.pose, rest) < dist(a.pose, rest) ? b : a));
          if (i > cursor) regimes.push({ from: cursor, to: i - 1, rest });
          regimes.push({ from: i, to: end, rest: local.pose });
          cursor = end + 1;
        }
      }
      i = j;
    } else {
      i += 1;
    }
  }
  if (cursor < poses.length) regimes.push({ from: cursor, to: poses.length - 1, rest });

  const demonstrations: Demonstration[] = [];
  const regimeSummaries: SegmentationSummary["regimes"] = [];
  let completeCycles = 0;
  let fragmentCycles = 0;

  for (const regime of regimes) {
    const d = poses.slice(regime.from, regime.to + 1).map((p) => dist(p, regime.rest)).filter(Number.isFinite);
    const baseline = percentile(d, 0.2);
    const amplitude = percentile(d, 0.95);
    const span = amplitude - baseline;
    const enterThreshold = baseline + 0.35 * span;
    const exitThreshold = baseline + 0.25 * span;
    regimeSummaries.push({
      startMs: times[regime.from]!,
      endMs: times[regime.to]!,
      enterThreshold,
      exitThreshold,
    });
    if (span < TUNING.minAmplitude) continue;

    const segmenter = new PoseSegmenter({
      enterThreshold,
      exitThreshold,
      minExcursion: baseline + 0.5 * span,
      minimumVisibility: floor,
      planar: true,
      reanchorStableMs: Number.POSITIVE_INFINITY,
    });
    segmenter.setReference(regime.rest);
    const startedAway = (d[0] ?? 0) > exitThreshold;
    const regimeStartMs = times[regime.from]!;

    const accept = (event: SegmentationEvent) => {
      const demo = event.demonstration;
      const openAtStart = startedAway && demo.startMs <= regimeStartMs;
      if (event.type === "CYCLE_FRAGMENT" || openAtStart) {
        fragmentCycles += 1;
        demonstrations.push({ ...demo, classification: "fragment" });
      } else {
        completeCycles += 1;
        demonstrations.push(demo);
      }
    };

    for (let k = regime.from; k <= regime.to; k += 1) {
      for (const event of segmenter.update(usable[k]!)) accept(event);
    }
    for (const event of segmenter.flush()) accept(event);
  }

  demonstrations.sort((a, b) => a.startMs - b.startMs);
  return {
    demonstrations,
    diagnostics: {
      usableFrames: usable.length,
      skippedLowVisibility: frames.length - usable.length,
      restSource,
      restDwellMs,
      regimes: regimeSummaries,
      completeCycles,
      fragmentCycles,
    },
  };
}

export function detectCycles(
  frames: PoseFrame[],
  referencePose?: NormalizedPose,
  options?: CycleDetectionOptions,
): Demonstration[] {
  return detectCyclesWithDiagnostics(frames, referencePose, options).demonstrations;
}

export function classifyDemonstrationManually(
  demo: Demonstration,
  classification: Demonstration["classification"],
): Demonstration {
  return {
    ...demo,
    classification,
    teacherConfirmed: true,
  };
}
