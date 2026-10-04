import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTeachingSession } from "../../src/frontend/analyze/SessionAnalyzer";
import { ReplayMediaSource } from "../../src/frontend/media/ReplayMediaSource";
import type { PoseRecording } from "../../src/frontend/pose/pose.types";

describe("analyzeTeachingSession", () => {
  it("uses supplied poseRecording and returns it on SessionAnalysis", async () => {
    const json = JSON.parse(
      readFileSync(path.resolve("fixtures/motion-cycle-a/teacher.pose.json"), "utf8"),
    ) as { schemaVersion: 1; frames: PoseRecording["frames"] };
    const recording: PoseRecording = {
      schemaVersion: 1,
      id: "rec-1",
      sessionId: "session-1",
      frames: json.frames,
    };
    const media = await new ReplayMediaSource(recording, "motion-cycle-a").produce();
    const analysis = await analyzeTeachingSession(media, {
      sessionId: "session-1",
      configSnapshot: {
        schemaVersion: 1,
        capturedAt: new Date().toISOString(),
        config: {
          schemaVersion: 1,
          pose: { leniency: 0.25, minimumVisibility: 0.65, sampleFps: 15, checkpointHoldMs: 150 },
          calibration: { lostTrackingMs: 1000 },
          review: { clipBeforeMs: 1500, clipAfterMs: 1500, maximumQuestions: 6 },
          coaching: { mismatchPersistenceMs: 500, minimumPromptIntervalMs: 2500 },
          debug: { enabled: true },
        },
      },
    });

    expect(analysis.poseRecording.frames.length).toBe(recording.frames.length);
    expect(analysis.demonstrations.length).toBe(1);
  });
});
