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
  const { goTo, refreshLessons, inputSource } = useApp();
  const [replay, setReplay] = useState<{ start: number; end: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const articulated = analysis.poseRecording.frames.some((f) => f.articulated3d);
  const retry = () => goTo(inputSource === "upload" ? "TEACH_READY" : "TEACH_RECORDING");

  const videoUrl = useObjectUrl(session.media?.video);

  const compilation = useMemo(() => {
    const frames = analysis.poseRecording.frames;
    const startDemo =
      analysis.demonstrations.find((d) => d.classification !== "fragment") ?? analysis.demonstrations[0];
    const startFrame =
      (startDemo && frames.find((f) => f.timestampMs >= startDemo.startMs)) ?? frames[0] ?? syntheticReferenceFrame();
    const calibration = session.calibration ?? captureBodyCalibration(startFrame);
    const referencePose = session.referencePose ?? startDemo?.trajectory[0] ?? calibration.neutralPose;
    try { return { lesson: compileLesson({
      draft: true,
      kind: session.kind,
      name: session.lessonName ?? "Untitled skill",
      importantThings: session.importantThings,
      sourceSessionId: session.id,
      teacherCalibration: calibration,
      referencePose,
      demonstrations: analysis.demonstrations,
      questions,
      teachBackItems,
    }) }; } catch (error) { return { error: error instanceof Error ? error.message : "Lesson compilation failed" }; }
  }, [analysis.demonstrations, analysis.poseRecording.frames, questions, session, teachBackItems]);
  const draftLesson = compilation.lesson;
  const available = new Set(draftLesson?.canonicalMovement.references?.filter((r) => r.alignmentEligible).map((r) => r.demonstrationId));
  const acceptedCount = [...available].filter((id) => !excluded.has(id)).length;

  const submit = async () => {
    if (!draftLesson || saving || (articulated && acceptedCount === 0)) return;
    setSaving(true);
    setError(null);
    try {
      const is3d = draftLesson.canonicalMovement.schemaVersion === 3;
      const confirmed = is3d ? compileLesson({ name: draftLesson.name, kind: session.kind, importantThings: session.importantThings,
        sourceSessionId: session.id, teacherCalibration: draftLesson.teacherCalibration, referencePose: draftLesson.referencePose,
        demonstrations: analysis.demonstrations.map((d) => excluded.has(d.id)
          ? { ...d, classification: "ignore", teacherConfirmed: false }
          : d.classification === "unknown" ? { ...d, classification: "good", teacherConfirmed: true } : d),
        questions, teachBackItems }) : draftLesson;
      await LessonRepository.save(confirmed);
      onSubmitted();
      goTo("TEACH_COMPLETE");
      // Saving is complete; remote library synchronization must not block confirmation.
      void refreshLessons();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (!draftLesson) return <div className="lesson-review flow-panel">
    <p className="error-text" role="alert">{compilation.error}</p>
    <button type="button" onClick={retry}>{inputSource === "upload" ? "Choose another recording" : "Re-record"}</button>
  </div>;

  return (
    <div className="lesson-review flow-panel">
      <LessonMap
        lesson={draftLesson}
        onReplayEvidence={videoUrl ? (startMs, endMs) => setReplay({ start: startMs, end: endMs }) : undefined}
      />
      {articulated ? <section aria-label="Teacher executions">
        <h3>Teacher executions</h3>
        <ul className="cycle-list">
          {analysis.demonstrations.map((demo, index) => <li key={demo.id}>
            <label className="checkbox-row">
              <input type="checkbox" disabled={saving || !available.has(demo.id)}
                checked={available.has(demo.id) && !excluded.has(demo.id)}
                onChange={(e) => { const checked = e.target.checked; setExcluded((prior) => {
                  const next = new Set(prior); if (checked) next.delete(demo.id); else next.add(demo.id); return next;
                }); }} />
              Execution {index + 1}: {(demo.startMs / 1000).toFixed(1)}s to {(demo.endMs / 1000).toFixed(1)}s
              {!available.has(demo.id) ? ` (${demo.classification === "fragment" ? "Fragment" : "Unavailable"})` : ""}
            </label>
            {videoUrl ? <button type="button" onClick={() => setReplay({start: demo.startMs, end: demo.endMs})}>Replay execution {index + 1}</button> : null}
          </li>)}
        </ul>
        {acceptedCount === 0 ? <p className="error-text" role="alert">Select at least one usable execution, or record again.</p> : null}
      </section> : null}
      {draftLesson.canonicalMovement.references?.filter((r) => r.alignmentEligible === false).map((r) => <p className="error-text" key={r.demonstrationId}>Reference unavailable for matching: {r.rejectionReason}</p>)}
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
        <button type="button" className="secondary" disabled={saving} onClick={retry}>
          {inputSource === "upload" ? "Choose another recording" : "Re-record"}
        </button>
        <RecordingDownload video={session.media?.video} baseName={draftLesson.name} />
        <button type="button" className="primary" disabled={saving || (articulated && acceptedCount === 0)} onClick={() => void submit()}>
          {saving ? "Saving..." : "Submit lesson"}
        </button>
      </div>
    </div>
  );
}
