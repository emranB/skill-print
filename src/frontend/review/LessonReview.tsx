import { useMemo, useState } from "react";
import { RecordingDownload } from "../teach/RecordingDownload";
import { useObjectUrl } from "../media/useObjectUrl";
import { useApp } from "../app/AppContext";
import { compileLesson } from "../lesson/LessonCompiler";
import { LessonMap } from "../lesson/LessonMap";
import { LessonRepository } from "../storage/LessonRepository";
import type { QuestionCandidate } from "../analyze/analyze.types";
import type { SessionAnalysis } from "../analyze/analyze.types";
import type { TeachingSession } from "../teach/teach.types";
import type { TeachBackItem } from "../lesson/TeachBackItems";
import { MomentPlayer } from "../media/MomentPlayer";
import { syntheticReferenceFrame } from "../teach/syntheticPose";
import { captureBodyCalibration } from "../calibration/BodyCalibration";

interface Props {
  session: TeachingSession;
  analysis: SessionAnalysis;
  questions: QuestionCandidate[];
  teachBackItems: TeachBackItem[];
  onSubmitted: () => void;
}

export function LessonReview({ session, analysis, questions, teachBackItems, onSubmitted }: Props) {
  const { goTo, refreshLessons } = useApp();
  const [replay, setReplay] = useState<{ start: number; end: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const videoUrl = useObjectUrl(session.media?.video);

  const draftLesson = useMemo(() => {
    const frames = analysis.poseRecording.frames;
    const startDemo =
      analysis.demonstrations.find((d) => d.classification !== "fragment") ?? analysis.demonstrations[0];
    const startFrame =
      (startDemo && frames.find((f) => f.timestampMs >= startDemo.startMs)) ?? frames[0] ?? syntheticReferenceFrame();
    const calibration = session.calibration ?? captureBodyCalibration(startFrame);
    const referencePose = session.referencePose ?? startDemo?.trajectory[0] ?? calibration.neutralPose;
    return compileLesson({
      name: session.lessonName ?? "Untitled skill",
      importantThings: session.importantThings,
      sourceSessionId: session.id,
      teacherCalibration: calibration,
      referencePose,
      demonstrations: analysis.demonstrations,
      questions,
      teachBackItems,
    });
  }, [analysis.demonstrations, analysis.poseRecording.frames, questions, session, teachBackItems]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      await LessonRepository.save(draftLesson);
      await refreshLessons();
      onSubmitted();
      goTo("TEACH_COMPLETE");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="lesson-review flow-panel">
      <LessonMap
        lesson={draftLesson}
        onReplayEvidence={videoUrl ? (startMs, endMs) => setReplay({ start: startMs, end: endMs }) : undefined}
      />
      {replay ? (
        <MomentPlayer
          src={videoUrl}
          clipStartMs={replay.start}
          clipEndMs={replay.end}
          className="moment-clip"
        />
      ) : null}
      {error ? <p className="error-text">{error}</p> : null}
      <div className="home-actions">
        <button type="button" className="secondary" onClick={() => goTo("TEACH_EDITING")}>
          Edit lesson
        </button>
        <RecordingDownload video={session.media?.video} baseName={draftLesson.name} />
        <button type="button" className="primary" disabled={saving} onClick={() => void submit()}>
          {saving ? "Saving..." : "Submit lesson"}
        </button>
      </div>
    </div>
  );
}
