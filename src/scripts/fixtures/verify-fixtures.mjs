import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.join(import.meta.dirname, "..");

const { PoseSegmenter } = await import(
  pathToFileURL(path.join(root, "src/frontend/pose/PoseSegmenter.ts")).href
);
const { normalizePose, normalizeLandmarks } = await import(
  pathToFileURL(path.join(root, "src/frontend/pose/PoseNormalizer.ts")).href
);
const { poseSimilarity, poseDistance } = await import(
  pathToFileURL(path.join(root, "src/frontend/pose/PoseDistance.ts")).href
);

function loadFrames(rel) {
  return JSON.parse(fs.readFileSync(path.join(root, rel), "utf8")).frames;
}

function segmentCycles(frames, debug = false) {
  const seg = new PoseSegmenter();
  seg.setReference(normalizePose(frames[0]));
  let cycles = 0;
  for (const f of frames) {
    const before = seg.getPhase();
    for (const e of seg.update(f)) {
      if (e.type === "CYCLE_COMPLETE") cycles += 1;
    }
    if (debug) {
      const ref = normalizePose(frames[0]);
      const d = poseDistance(normalizePose(f), ref);
      console.log(f.timestampMs, before, "->", seg.getPhase(), "d", d.toFixed(3));
    }
  }
  return cycles;
}

function checkpointRepCount(teacherFrames, studentFrames, leniency = 0.25) {
  const required = 1 - leniency;
  const amounts = teacherFrames.map((_, i) => {
    const t = teacherFrames[i].timestampMs;
    const dwell = 420;
    const rampEnd = 2000 - dwell;
    if (t < dwell || t > rampEnd) return 0;
    const u = (t - dwell) / (rampEnd - dwell);
    return Math.sin(u * Math.PI);
  });

  const apexAmount = Math.max(...amounts);
  const pickOutbound = (progress) => {
    const target = (progress / 100) * apexAmount;
    let bestIdx = 0;
    let bestErr = Infinity;
    for (let i = 0; i < amounts.length; i++) {
      if (amounts[i] <= 0.001) continue;
      const err = Math.abs(amounts[i] - target);
      if (err < bestErr) {
        bestErr = err;
        bestIdx = i;
      }
    }
    return normalizeLandmarks(teacherFrames[bestIdx].landmarks, 0.35);
  };

  const pickInbound = (progress) => {
    const target = (progress / 100) * apexAmount;
    let bestIdx = amounts.length - 1;
    let bestErr = Infinity;
    for (let i = 0; i < amounts.length; i++) {
      if (amounts[i] <= 0.001) continue;
      const err = Math.abs(amounts[i] - target);
      if (err < bestErr) {
        bestErr = err;
        bestIdx = i;
      }
    }
    return normalizeLandmarks(teacherFrames[bestIdx].landmarks, 0.35);
  };

  const sequence = [
    pickOutbound(0),
    pickOutbound(25),
    pickOutbound(50),
    pickOutbound(75),
    pickOutbound(100),
    pickInbound(75),
    pickInbound(50),
    pickInbound(25),
    pickInbound(0),
  ];

  let expected = 0;
  let repSuccess = 0;
  let lastAdvanceMs = -Infinity;

  for (const frame of studentFrames) {
    const pose = normalizeLandmarks(frame.landmarks, 0.35);
    const target = sequence[expected];
    const sim = poseSimilarity({ landmarks: pose }, { landmarks: target.landmarks ?? target }, {
      minimumVisibility: 0.35,
    });
    if (sim >= required && frame.timestampMs - lastAdvanceMs >= 120) {
      expected += 1;
      lastAdvanceMs = frame.timestampMs;
      if (expected >= sequence.length) {
        repSuccess += 1;
        expected = 0;
        lastAdvanceMs = frame.timestampMs;
      }
    }
  }
  return repSuccess;
}

function maxDistance(frames) {
  const ref = normalizePose(frames[0]);
  let max = 0;
  for (const f of frames) {
    max = Math.max(max, poseDistance(normalizePose(f), ref));
  }
  return max;
}

function distanceTrace(frames) {
  const ref = normalizePose(frames[0]);
  return frames.map((f) => ({
    t: f.timestampMs,
    d: poseDistance(normalizePose(f), ref),
  }));
}

for (const dir of ["motion-cycle-a", "motion-cycle-b", "squat", "pushup"]) {
  const teacher = loadFrames(`fixtures/${dir}/teacher.pose.json`);
  const good = loadFrames(`fixtures/${dir}/student-good.pose.json`);
  const bad = loadFrames(`fixtures/${dir}/student-bad.pose.json`);
  console.log(dir, {
    teacherMaxDist: maxDistance(teacher),
    goodMaxDist: maxDistance(good),
    badMaxDist: maxDistance(bad),
    teacherCycles: segmentCycles(teacher),
    goodCycles: segmentCycles(good),
    badCycles: segmentCycles(bad),
    goodReps: checkpointRepCount(teacher, good),
    badReps: checkpointRepCount(teacher, bad),
  });
}
