/**
 * Probe Level B media metadata. Does not influence analysis.
 * Usage: node src/scripts/level-b/probe-level-b-media.mjs [path]
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import ffprobe from "ffprobe-static";

const mediaPath = path.resolve(process.argv[2] || "data/lesson-squat.mp4");
if (!fs.existsSync(mediaPath)) {
  console.error(JSON.stringify({ ok: false, error: "FILE_MISSING", mediaPath }, null, 2));
  process.exit(2);
}

const probed = spawnSync(
  ffprobe.path,
  [
    "-v",
    "error",
    "-show_entries",
    "format=duration,size,bit_rate,format_name",
    "-show_entries",
    "stream=index,codec_type,codec_name,width,height,r_frame_rate,avg_frame_rate,duration,nb_frames,sample_rate,channels",
    "-of",
    "json",
    mediaPath,
  ],
  { encoding: "utf8" },
);

if (probed.status !== 0) {
  console.error(
    JSON.stringify(
      { ok: false, error: "FFPROBE_FAILED", stderr: probed.stderr, mediaPath },
      null,
      2,
    ),
  );
  process.exit(3);
}

const json = JSON.parse(probed.stdout);
const video = (json.streams || []).find((s) => s.codec_type === "video");
const audio = (json.streams || []).find((s) => s.codec_type === "audio");
const report = {
  ok: Boolean(video && audio),
  mediaPath,
  bytes: fs.statSync(mediaPath).size,
  format: json.format,
  video: video
    ? {
        codec: video.codec_name,
        width: video.width,
        height: video.height,
        rFrameRate: video.r_frame_rate,
        avgFrameRate: video.avg_frame_rate,
        durationSec: Number(video.duration),
        nbFrames: Number(video.nb_frames),
      }
    : null,
  audio: audio
    ? {
        codec: audio.codec_name,
        sampleRate: Number(audio.sample_rate),
        channels: audio.channels,
        durationSec: Number(audio.duration),
        nbFrames: Number(audio.nb_frames),
      }
    : null,
};

console.log(JSON.stringify(report, null, 2));
process.exit(report.ok ? 0 : 4);
