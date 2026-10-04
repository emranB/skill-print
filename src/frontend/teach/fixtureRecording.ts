import { FakeSessionClock } from "../clock/SessionClock";
import { ReplayMediaSource } from "../media/ReplayMediaSource";
import type { TeachingMedia } from "../media/media.types";
import { PoseSegmenter } from "../pose/PoseSegmenter";
import type { Demonstration, NormalizedPose, PoseRecording } from "../pose/pose.types";
import { DebugBus } from "../debug/DebugBus";

export interface FixtureRecordingResult {
  media: TeachingMedia;
  demonstrations: Demonstration[];
  poseRecording: PoseRecording;
}

export async function buildFixtureTeachingCapture(
  poseRecording: PoseRecording,
  referencePose: NormalizedPose | undefined,
  sourceName: string,
): Promise<FixtureRecordingResult> {
  const clock = new FakeSessionClock();
  clock.start();
  const segmenter = new PoseSegmenter();
  if (referencePose) {
    segmenter.setReference(referencePose);
  } else if (poseRecording.frames.length > 0) {
    segmenter.captureReference(poseRecording.frames.slice(0, 5));
  }

  const demonstrations: Demonstration[] = [];
  for (const frame of poseRecording.frames) {
    clock.set(frame.timestampMs);
    const events = segmenter.update(frame);
    for (const event of events) {
      demonstrations.push(event.demonstration);
    }
  }
  clock.stop();

  const source = new ReplayMediaSource(poseRecording, sourceName);
  const media = await source.produce();

  DebugBus.emit({
    category: "MEDIA",
    event: "FIXTURE_RECORDING_COMPLETE",
    data: { frames: poseRecording.frames.length, cycles: demonstrations.length },
  });

  return { media, demonstrations, poseRecording };
}
