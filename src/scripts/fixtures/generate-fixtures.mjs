/**
 * Generates Level C deterministic pose fixtures under fixtures/.
 * Run: node src/scripts/fixtures/generate-fixtures.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const FIXTURES = path.join(ROOT, "fixtures");

const POSE_LANDMARK = {
  NOSE: 0,
  LEFT_SHOULDER: 11,
  RIGHT_SHOULDER: 12,
  LEFT_ELBOW: 13,
  RIGHT_ELBOW: 14,
  LEFT_WRIST: 15,
  RIGHT_WRIST: 16,
  LEFT_HIP: 23,
  RIGHT_HIP: 24,
  LEFT_KNEE: 25,
  RIGHT_KNEE: 26,
  LEFT_ANKLE: 27,
  RIGHT_ANKLE: 28,
};

const MAJOR_JOINTS = [11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
const VIS = 0.95;
const FRAME_INTERVAL_MS = 66;
const CYCLE_DURATION_MS = 2000;

function lm(x, y, z = 0, visibility = VIS) {
  return { x, y, z, visibility };
}

/** MediaPipe Pose 33-point standing skeleton (image coords, y increases downward). */
function buildStandingPose() {
  const cx = 0.5;
  const landmarks = new Array(33);

  landmarks[0] = lm(cx, 0.17);
  landmarks[1] = lm(cx - 0.02, 0.16);
  landmarks[2] = lm(cx - 0.025, 0.16);
  landmarks[3] = lm(cx - 0.03, 0.16);
  landmarks[4] = lm(cx + 0.02, 0.16);
  landmarks[5] = lm(cx + 0.025, 0.16);
  landmarks[6] = lm(cx + 0.03, 0.16);
  landmarks[7] = lm(cx - 0.06, 0.17);
  landmarks[8] = lm(cx + 0.06, 0.17);
  landmarks[9] = lm(cx - 0.025, 0.2);
  landmarks[10] = lm(cx + 0.025, 0.2);

  landmarks[11] = lm(cx - 0.11, 0.32);
  landmarks[12] = lm(cx + 0.11, 0.32);
  landmarks[13] = lm(cx - 0.14, 0.44);
  landmarks[14] = lm(cx + 0.14, 0.44);
  landmarks[15] = lm(cx - 0.15, 0.56);
  landmarks[16] = lm(cx + 0.15, 0.56);

  landmarks[17] = lm(cx - 0.16, 0.58);
  landmarks[18] = lm(cx + 0.16, 0.58);
  landmarks[19] = lm(cx - 0.155, 0.57);
  landmarks[20] = lm(cx + 0.155, 0.57);
  landmarks[21] = lm(cx - 0.13, 0.54);
  landmarks[22] = lm(cx + 0.13, 0.54);

  landmarks[23] = lm(cx - 0.09, 0.54);
  landmarks[24] = lm(cx + 0.09, 0.54);
  landmarks[25] = lm(cx - 0.09, 0.72);
  landmarks[26] = lm(cx + 0.09, 0.72);
  landmarks[27] = lm(cx - 0.09, 0.9);
  landmarks[28] = lm(cx + 0.09, 0.9);
  landmarks[29] = lm(cx - 0.1, 0.92);
  landmarks[30] = lm(cx + 0.1, 0.92);
  landmarks[31] = lm(cx - 0.08, 0.91);
  landmarks[32] = lm(cx + 0.08, 0.91);

  return landmarks;
}

function cloneLandmarks(landmarks) {
  return landmarks.map((p) => ({ ...p }));
}

function hipMidpoint(landmarks) {
  const l = landmarks[POSE_LANDMARK.LEFT_HIP];
  const r = landmarks[POSE_LANDMARK.RIGHT_HIP];
  if (!l || !r) return { x: 0.5, y: 0.5, z: 0 };
  return {
    x: (l.x + r.x) / 2,
    y: (l.y + r.y) / 2,
    z: (l.z + r.z) / 2,
  };
}

function torsoLength(landmarks) {
  const ls = landmarks[POSE_LANDMARK.LEFT_SHOULDER];
  const rs = landmarks[POSE_LANDMARK.RIGHT_SHOULDER];
  const lh = landmarks[POSE_LANDMARK.LEFT_HIP];
  const rh = landmarks[POSE_LANDMARK.RIGHT_HIP];
  if (!ls || !rs || !lh || !rh) return 0;
  const sx = (ls.x + rs.x) / 2;
  const sy = (ls.y + rs.y) / 2;
  const hx = (lh.x + rh.x) / 2;
  const hy = (lh.y + rh.y) / 2;
  return Math.hypot(sx - hx, sy - hy);
}

function shoulderWidth(landmarks) {
  const l = landmarks[POSE_LANDMARK.LEFT_SHOULDER];
  const r = landmarks[POSE_LANDMARK.RIGHT_SHOULDER];
  if (!l || !r) return 0;
  return Math.hypot(l.x - r.x, l.y - r.y);
}

function hipWidth(landmarks) {
  const l = landmarks[POSE_LANDMARK.LEFT_HIP];
  const r = landmarks[POSE_LANDMARK.RIGHT_HIP];
  if (!l || !r) return 0;
  return Math.hypot(l.x - r.x, l.y - r.y);
}

function computeBodyScale(landmarks) {
  const torso = torsoLength(landmarks);
  const shoulders = shoulderWidth(landmarks);
  const hips = hipWidth(landmarks);
  const candidates = [torso, shoulders * 1.6, hips * 1.8].filter((v) => v > 1e-6);
  if (candidates.length === 0) return 1;
  return candidates.reduce((a, b) => a + b, 0) / candidates.length;
}

function normalizeLandmarks(landmarks, minimumVisibility = 0) {
  const origin = hipMidpoint(landmarks);
  const scale = Math.max(computeBodyScale(landmarks), 1e-4);
  return landmarks.map((lm) => {
    const visibility = lm.visibility ?? 0;
    if (visibility < minimumVisibility) {
      return { x: 0, y: 0, z: 0, visibility };
    }
    return {
      x: (lm.x - origin.x) / scale,
      y: (lm.y - origin.y) / scale,
      z: (lm.z - origin.z) / scale,
      visibility,
    };
  });
}

function normalizeFrame(frame, minimumVisibility = 0.35) {
  return {
    timestampMs: frame.timestampMs,
    landmarks: normalizeLandmarks(frame.landmarks, minimumVisibility),
  };
}

function poseDistance(a, b, minimumVisibility = 0.35) {
  let sum = 0;
  let count = 0;
  for (const index of MAJOR_JOINTS) {
    const pa = a.landmarks[index];
    const pb = b.landmarks[index];
    if (!pa || !pb) continue;
    if ((pa.visibility ?? 0) < minimumVisibility || (pb.visibility ?? 0) < minimumVisibility) {
      continue;
    }
    sum += Math.hypot(pa.x - pb.x, pa.y - pb.y, pa.z - pb.z);
    count += 1;
  }
  if (count === 0) return Number.POSITIVE_INFINITY;
  return sum / count;
}

/** Single excursion 0→1→0 with dwell at start/end (matches PoseSegmenter-friendly timing). */
function excursionAmountAtTime(tMs, durationMs = CYCLE_DURATION_MS) {
  const dwell = 550;
  const rampStart = dwell;
  const rampEnd = durationMs - dwell;
  if (tMs < rampStart) return 0;
  if (tMs > rampEnd) return 0;
  const u = (tMs - rampStart) / (rampEnd - rampStart);
  return Math.sin(u * Math.PI);
}

function applyLowerBodyExcursion(landmarks, amount) {
  const a = amount;
  const indicesDown = [23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
  const indicesTorso = [11, 12, 0, 9, 10];
  for (const i of indicesDown) {
    landmarks[i].y += 0.28 * a;
    landmarks[i].x += (i % 2 === 1 ? -1 : 1) * 0.015 * a;
  }
  for (const i of indicesTorso) {
    landmarks[i].y += 0.05 * a;
  }
}

function applyUpperBodyExcursion(landmarks, amount) {
  const a = amount;
  const armUp = [13, 14, 15, 16, 17, 18, 19, 20, 21, 22];
  for (const i of armUp) {
    landmarks[i].y -= 0.2 * a;
    landmarks[i].z -= 0.08 * a;
  }
  landmarks[11].y -= 0.04 * a;
  landmarks[12].y -= 0.04 * a;
  landmarks[0].y -= 0.06 * a;
}

function applyPushupExcursion(landmarks, amount) {
  const a = amount;
  const upper = [0, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  for (const i of upper) {
    landmarks[i].y += 0.14 * a;
    landmarks[i].z -= 0.12 * a;
  }
  for (const i of [13, 14]) {
    landmarks[i].y += 0.08 * a;
  }
  for (const i of [15, 16]) {
    landmarks[i].y += 0.05 * a;
  }
  landmarks[25].y += 0.02 * a;
  landmarks[26].y += 0.02 * a;
}

function makeFrame(timestampMs, landmarks) {
  const worldLandmarks = landmarks.map((p) => ({
    x: p.x,
    y: p.y,
    z: p.z - 0.02,
    visibility: p.visibility,
  }));
  return { timestampMs, landmarks: cloneLandmarks(landmarks), worldLandmarks };
}

function generateMotionFrames(applyExcursion, durationMs = CYCLE_DURATION_MS) {
  const frames = [];
  for (let t = 0; t <= durationMs; t += FRAME_INTERVAL_MS) {
    const landmarks = buildStandingPose();
    const amount = excursionAmountAtTime(t, durationMs);
    applyExcursion(landmarks, amount);
    frames.push(makeFrame(t, landmarks));
  }
  return frames;
}

function writePoseFixture(dir, name, frames) {
  const payload = { schemaVersion: 1, frames };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeJson(dir, name, data) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function blendLandmarks(a, b, t) {
  return a.map((pa, i) => {
    const pb = b[i];
    return {
      x: pa.x * (1 - t) + pb.x * t,
      y: pa.y * (1 - t) + pb.y * t,
      z: pa.z * (1 - t) + pb.z * t,
      visibility: Math.min(pa.visibility ?? VIS, pb.visibility ?? VIS),
    };
  });
}

function cloneFrames(frames) {
  return frames.map((f) => ({
    timestampMs: f.timestampMs,
    landmarks: cloneLandmarks(f.landmarks),
    worldLandmarks: cloneLandmarks(f.worldLandmarks),
  }));
}

function perturbFrames(frames, scale = 0.012) {
  return frames.map((f, fi) =>
    makeFrame(
      f.timestampMs,
      f.landmarks.map((p, pi) => ({
        ...p,
        x: p.x + scale * Math.sin(fi * 0.7 + pi * 0.3),
        y: p.y + scale * Math.cos(fi * 0.5 + pi * 0.2),
      })),
    ),
  );
}

function buildStudentGood(teacherFrames) {
  return perturbFrames(teacherFrames, 0.004);
}

/**
 * Early progress then freeze at a mid-outbound pose.
 * May resemble later poses, but never returns to start, so CheckpointTracker
 * must not emit REP_SUCCESS (sequential; no skip-to-end).
 */
function buildStudentBad(teacherFrames, _snapProgress = 0.88) {
  const out = cloneFrames(teacherFrames);
  const freezeIdx = Math.max(2, Math.floor((teacherFrames.length - 1) * 0.28));
  const freezeLandmarks = teacherFrames[freezeIdx].landmarks;
  for (let i = freezeIdx + 1; i < out.length; i++) {
    // Drift slightly toward a later frame pose to look "later-like" without returning.
    const later = teacherFrames[Math.min(teacherFrames.length - 1, freezeIdx + 8)].landmarks;
    const landmarks = blendLandmarks(freezeLandmarks, later, 0.35);
    // Push laterally so return-to-start similarity stays low.
    for (const idx of MAJOR_JOINTS) {
      landmarks[idx] = {
        ...landmarks[idx],
        x: landmarks[idx].x + 0.12,
      };
    }
    out[i] = makeFrame(out[i].timestampMs, landmarks);
  }
  return out;
}

function simulatePoseSegmenter(frames, options = {}) {
  const enterThreshold = options.enterThreshold ?? 0.18;
  const exitThreshold = options.exitThreshold ?? 0.1;
  const pauseSpeedThreshold = options.pauseSpeedThreshold ?? 0.02;
  const returnDwellMs = options.returnDwellMs ?? 400;
  const minExcursion = options.minExcursion ?? 0.22;
  const minCycleMs = options.minCycleMs ?? 250;
  const minimumVisibility = options.minimumVisibility ?? 0.35;

  const reference = normalizeFrame(frames[0], minimumVisibility);
  let phase = "NEAR_START";
  let maxDistance = 0;
  let nearStartSince = null;
  let lastPose = null;
  let cycles = 0;

  for (const frame of frames) {
    const pose = normalizeFrame(frame, minimumVisibility);
    const distance = poseDistance(pose, reference, minimumVisibility);
    if (!Number.isFinite(distance)) continue;

    const speed = lastPose
      ? poseDistance(pose, lastPose, minimumVisibility) /
        Math.max(1, pose.timestampMs - lastPose.timestampMs)
      : 0;

    if (phase === "NEAR_START") {
      if (distance >= enterThreshold) {
        phase = "ACTIVE";
        maxDistance = distance;
        nearStartSince = null;
      }
    } else if (phase === "ACTIVE" || phase === "PAUSED") {
      if (distance > maxDistance) maxDistance = distance;

      if (distance <= exitThreshold && maxDistance >= minExcursion) {
        if (nearStartSince === null) nearStartSince = pose.timestampMs;
        if (pose.timestampMs - nearStartSince >= returnDwellMs) {
          const duration = pose.timestampMs - (lastPose?.timestampMs ?? 0);
          if (duration >= minCycleMs || pose.timestampMs >= minCycleMs) {
            cycles += 1;
          }
          phase = "NEAR_START";
          maxDistance = 0;
          nearStartSince = null;
        }
      } else {
        nearStartSince = null;
      }

      if (phase === "ACTIVE" && speed < pauseSpeedThreshold && distance > exitThreshold) {
        phase = "PAUSED";
      } else if (phase === "PAUSED" && speed >= pauseSpeedThreshold) {
        phase = "ACTIVE";
      }
    }

    lastPose = pose;
  }

  return cycles;
}

function makeTranscript(skillName, durationMs) {
  const words = [
    { text: "Set", startMs: 120, endMs: 280 },
    { text: "your", startMs: 280, endMs: 420 },
    { text: "stance", startMs: 420, endMs: 720 },
    { text: "before", startMs: 900, endMs: 1100 },
    { text: "the", startMs: 1100, endMs: 1220 },
    { text: skillName.toLowerCase(), startMs: 1220, endMs: 1600 },
    { text: "rep", startMs: 1600, endMs: 1880 },
  ];
  return {
    schemaVersion: 1,
    words,
    fullText: words.map((w) => w.text).join(" "),
    durationMs,
  };
}

const stats = [];

function record(relPath, frames) {
  stats.push({ file: relPath.replace(/\\/g, "/"), frames: frames.length });
}

// motion-cycle-a: lower-body dominant
{
  const dir = path.join(FIXTURES, "motion-cycle-a");
  const teacher = generateMotionFrames(applyLowerBodyExcursion);
  writePoseFixture(dir, "teacher.pose.json", teacher);
  record("fixtures/motion-cycle-a/teacher.pose.json", teacher);

  const good = buildStudentGood(teacher);
  writePoseFixture(dir, "student-good.pose.json", good);
  record("fixtures/motion-cycle-a/student-good.pose.json", good);

  const bad = buildStudentBad(teacher, 0.66);
  writePoseFixture(dir, "student-bad.pose.json", bad);
  record("fixtures/motion-cycle-a/student-bad.pose.json", bad);

  const segTeacher = simulatePoseSegmenter(teacher);
  const segGood = simulatePoseSegmenter(good);
  const segBad = simulatePoseSegmenter(bad);

  writeJson(dir, "expected.json", {
    schemaVersion: 1,
    expectedCycles: 1,
    notes:
      "Teacher lower-body excursion: reference at frame 0, one PoseSegmenter cycle (~2000ms). student-good should achieve one REP_SUCCESS; student-bad must not.",
  });
  if (segTeacher !== 1 || segGood !== 1 || segBad !== 0) {
    console.warn(
      `motion-cycle-a segmenter: teacher=${segTeacher} good=${segGood} bad=${segBad}`,
    );
  }
  record("fixtures/motion-cycle-a/expected.json", [{ length: 1 }]);
}

// motion-cycle-b: upper-body dominant
{
  const dir = path.join(FIXTURES, "motion-cycle-b");
  const teacher = generateMotionFrames(applyUpperBodyExcursion);
  writePoseFixture(dir, "teacher.pose.json", teacher);
  record("fixtures/motion-cycle-b/teacher.pose.json", teacher);

  const good = buildStudentGood(teacher);
  writePoseFixture(dir, "student-good.pose.json", good);
  record("fixtures/motion-cycle-b/student-good.pose.json", good);

  const bad = buildStudentBad(teacher, 0.66);
  writePoseFixture(dir, "student-bad.pose.json", bad);
  record("fixtures/motion-cycle-b/student-bad.pose.json", bad);

  const segTeacherB = simulatePoseSegmenter(teacher);
  const segGoodB = simulatePoseSegmenter(good);
  const segBadB = simulatePoseSegmenter(bad);
  writeJson(dir, "expected.json", {
    schemaVersion: 1,
    expectedCycles: 1,
    notes:
      "Teacher vertical arm reach excursion (cycle B). student-good matches checkpoint order; student-bad snaps toward apex without completing sequence.",
  });
  if (segTeacherB !== 1 || segGoodB !== 1 || segBadB !== 0) {
    console.warn(
      `motion-cycle-b segmenter: teacher=${segTeacherB} good=${segGoodB} bad=${segBadB}`,
    );
  }
  record("fixtures/motion-cycle-b/expected.json", [{ length: 1 }]);
}

function writeSkillFixtures(skillDir, applyExcursion, skillLabel) {
  const dir = path.join(FIXTURES, skillDir);
  const teacher = generateMotionFrames(applyExcursion);
  writePoseFixture(dir, "teacher.pose.json", teacher);
  record(`fixtures/${skillDir}/teacher.pose.json`, teacher);

  const good = buildStudentGood(teacher);
  writePoseFixture(dir, "student-good.pose.json", good);
  record(`fixtures/${skillDir}/student-good.pose.json`, good);

  const bad = buildStudentBad(teacher, 0.78);
  writePoseFixture(dir, "student-bad.pose.json", bad);
  record(`fixtures/${skillDir}/student-bad.pose.json`, bad);

  writeJson(dir, "transcript.json", makeTranscript(skillLabel, CYCLE_DURATION_MS));
  record(`fixtures/${skillDir}/transcript.json`, [{ length: 1 }]);

  const segTeacher = simulatePoseSegmenter(teacher);
  const segGood = simulatePoseSegmenter(good);
  const segBad = simulatePoseSegmenter(bad);
  writeJson(dir, "expected.json", {
    schemaVersion: 1,
    expectedCycles: 1,
    notes: `${skillLabel} Level C geometry-only fixture; one outbound/return checkpoint path; student-good one REP_SUCCESS at default leniency 0.25.`,
  });
  if (segTeacher !== 1 || segGood !== 1 || segBad !== 0) {
    console.warn(
      `${skillDir} segmenter: teacher=${segTeacher} good=${segGood} bad=${segBad}`,
    );
  }
  record(`fixtures/${skillDir}/expected.json`, [{ length: 1 }]);
}

writeSkillFixtures("squat", applyLowerBodyExcursion, "Squat");
writeSkillFixtures("pushup", applyPushupExcursion, "Pushup");

console.log("Generated Level C pose fixtures:");
for (const s of stats) {
  if (s.file.endsWith(".pose.json")) {
    console.log(`  ${s.file}: ${s.frames} frames`);
  } else {
    console.log(`  ${s.file}`);
  }
}
