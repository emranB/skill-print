/**
 * Writes the browser demo student fixtures (public/fixtures/motion-cycle-a) from the
 * Level C fixtures at a human rep pace. The Level C cycle lasts 2 s, which is too fast
 * for the runtime checkpoint hold; the demo copy interpolates it to a 6 s rep.
 * Run: node src/scripts/fixtures/pace-demo-fixtures.mjs
 */
import fs from "node:fs";
import path from "node:path";

const PACE_FACTOR = 3;
const SOURCE = path.resolve("fixtures/motion-cycle-a");
const TARGET = path.resolve("public/fixtures/motion-cycle-a");

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function pace(recording) {
  const frames = recording.frames;
  const interval = frames[1].timestampMs - frames[0].timestampMs;
  const out = [];
  for (let i = 0; i < frames.length - 1; i += 1) {
    const a = frames[i];
    const b = frames[i + 1];
    for (let k = 0; k < PACE_FACTOR; k += 1) {
      const t = k / PACE_FACTOR;
      out.push({
        ...a,
        timestampMs: out.length * interval,
        landmarks: a.landmarks.map((l, j) => {
          const m = b.landmarks[j];
          return {
            ...l,
            x: lerp(l.x, m.x, t),
            y: lerp(l.y, m.y, t),
            z: lerp(l.z, m.z, t),
            visibility: Math.min(l.visibility, m.visibility),
          };
        }),
      });
    }
  }
  out.push({ ...frames[frames.length - 1], timestampMs: out.length * interval });
  return { ...recording, frames: out };
}

for (const name of ["student-good.pose.json", "student-bad.pose.json"]) {
  const recording = JSON.parse(fs.readFileSync(path.join(SOURCE, name), "utf8"));
  const paced = pace(recording);
  fs.writeFileSync(path.join(TARGET, name), `${JSON.stringify(paced, null, 2)}\n`);
  console.log(`${name}: ${recording.frames.length} -> ${paced.frames.length} frames`);
}
