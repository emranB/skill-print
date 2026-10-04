import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/AppContext";
import { useApprentice } from "../apprentice/ApprenticeProvider";
import type { LearnPreparation } from "../apprentice/ApprenticeGateway";
import { CheckpointTracker } from "./CheckpointTracker";
import { CoachingSession } from "./CoachingSession";
import { LessonLibrary } from "./LessonLibrary";
import { StudentCalibration } from "./StudentCalibration";
import { GhostCoach } from "./GhostCoach";
import { SuccessOverlay } from "./SuccessOverlay";
import { MasteryReport } from "./MasteryReport";
import { LessonRepository } from "../storage/LessonRepository";
import type { Lesson } from "../lesson/lesson.types";
import { cameraErrorMessage, cameraManager, isSupersededError } from "../media/CameraManager";
import { useCameraStream } from "../media/useCamera";
import { LiveStage } from "../components/LiveStage";
import { normalizePose } from "../pose/PoseNormalizer";
import { loadPoseFixture, FIXTURE_STUDENT_GOOD, FIXTURE_STUDENT_BAD } from "../teach/poseFixtureLoader";
import type { Landmark, PoseFrame } from "../pose/pose.types";
import { framingHint, isUsablePose, missingJoints, usabilityFloor } from "../pose/PoseUsability";
import { useLivePose } from "../pose/useLivePose";
import { DebugBus } from "../debug/DebugBus";
import { ghostLandmarks } from "./ghostPose";

const PERSON_LOST_MS = 1500;

interface TrackProgress {
  index: number;
  similarity: number;
  frames: number;
}

export function LearnFlow() {
  const { state, goTo, inputSource, config, selectedLessonId } = useApp();
  const apprentice = useApprentice();
  const [predictionAnswer, setPredictionAnswer] = useState("");

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [preparation, setPreparation] = useState<LearnPreparation | null>(null);
  const [predictionDone, setPredictionDone] = useState(false);
  const [useBadFixture, setUseBadFixture] = useState(false);
  const [lessonError, setLessonError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TrackProgress>({ index: 0, similarity: 0, frames: 0 });
  const [studentLandmarks, setStudentLandmarks] = useState<Landmark[] | null>(null);
  const [coachingCue, setCoachingCue] = useState<string | null>(null);
  const [successVisible, setSuccessVisible] = useState(false);
  const [reps, setReps] = useState(0);
  const [corrections, setCorrections] = useState(0);

  const liveStream = useCameraStream();
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [personVisible, setPersonVisible] = useState(true);
  const floor = usabilityFloor(config.pose.minimumVisibility);

  const trackerRef = useRef<CheckpointTracker | null>(null);
  const coachingRef = useRef<CoachingSession | null>(null);
  const replayTimerRef = useRef<number | null>(null);
  const lastTrackedAtRef = useRef(0);

  const processStudentFrame = useCallback(
    (frame: PoseFrame) => {
      const trackingValid = isUsablePose(frame.landmarks, floor);
      if (trackingValid) {
        lastTrackedAtRef.current = performance.now();
        setPersonVisible(true);
      }
      setStudentLandmarks(frame.landmarks);
      const tracker = trackerRef.current;
      const coaching = coachingRef.current;
      if (!tracker || !coaching) return;
      const pose = normalizePose(frame, config.pose.minimumVisibility);
      const event = tracker.update(pose, trackingValid);
      const index = tracker.getExpectedIndex();
      const similarity = tracker.lastSimilarity;
      setProgress((p) =>
        p.index === index && Math.abs(p.similarity - similarity) < 0.02 && p.frames % 15 !== 0
          ? { ...p, frames: p.frames + 1 }
          : { index, similarity, frames: p.frames + 1 },
      );
      if (!event) return;
      if (event.type === "CHECKPOINT_PASSED") {
        DebugBus.emit({ category: "STUDENT", event: "CHECKPOINT_PASSED", data: { ...event } });
        setCoachingCue(null);
      }
      if (event.type === "REP_SUCCESS") {
        DebugBus.emit({ category: "STUDENT", event: "REP_SUCCESS", data: { trackingValid } });
        coaching.resetMismatch();
        setReps((r) => r + 1);
        setCoachingCue(null);
        setSuccessVisible(true);
        window.setTimeout(() => setSuccessVisible(false), 1200);
        return;
      }
      const cue = coaching.handleTrackerEvent(pose.timestampMs, event, pose);
      if (!cue) return;
      DebugBus.emit({ category: "COACH", event: "COACHING_CUE", message: cue, data: { checkpoint: index } });
      setCorrections(coaching.correctionCount);
      setCoachingCue(cue);
    },
    [config.pose.minimumVisibility, floor],
  );

  const liveTracking =
    inputSource !== "fixture" && (state === "LEARN_ACTIVE" || (state === "LEARN_START_POSITION" && predictionDone));
  const livePoseStatus = useLivePose(liveStream, liveTracking, processStudentFrame, { fps: config.pose.sampleFps });

  useEffect(() => {
    if (!liveTracking || livePoseStatus !== "running") return undefined;
    lastTrackedAtRef.current = performance.now();
    const timer = window.setInterval(() => {
      if (performance.now() - lastTrackedAtRef.current > PERSON_LOST_MS) {
        setPersonVisible(false);
        setStudentLandmarks(null);
      }
    }, 500);
    return () => window.clearInterval(timer);
  }, [liveTracking, livePoseStatus]);

  useEffect(() => {
    if (!liveTracking) return undefined;
    let released = false;
    void cameraManager
      .ensure({ video: true, audio: false })
      .then(() => {
        if (!released) setCameraError(null);
      })
      .catch((error: unknown) => {
        if (!released && !isSupersededError(error)) setCameraError(cameraErrorMessage(error));
      });
    return () => {
      released = true;
    };
  }, [liveTracking]);

  useEffect(() => {
    setLesson(null);
    setLessonError(null);
    setPreparation(null);
    setPredictionDone(false);
    setPredictionAnswer("");
    setReps(0);
    setCorrections(0);
    setCoachingCue(null);
    if (!selectedLessonId) return;
    let cancelled = false;
    LessonRepository.get(selectedLessonId)
      .then((found) => {
        if (cancelled) return;
        if (found) setLesson(found);
        else setLessonError("This lesson could not be found or is damaged. Pick another lesson.");
      })
      .catch((error: unknown) => {
        if (!cancelled) setLessonError(error instanceof Error ? error.message : "Lesson could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLessonId]);

  useEffect(() => {
    if (!lesson || preparation || !state.startsWith("LEARN_") || state === "LEARN_LIBRARY") return undefined;
    let cancelled = false;
    void apprentice.prepareLearning({ lesson }).then((prepared) => {
      if (!cancelled) setPreparation(prepared);
    });
    return () => {
      cancelled = true;
    };
  }, [apprentice, lesson, preparation, state]);

  useEffect(() => {
    if (state !== "LEARN_ACTIVE" || !lesson) return;

    trackerRef.current = new CheckpointTracker(lesson.canonicalMovement.checkpoints, {
      leniency: config.pose.leniency,
      minimumVisibility: config.pose.minimumVisibility,
      checkpointHoldMs: config.pose.checkpointHoldMs,
    });
    coachingRef.current = new CoachingSession(apprentice, config.coaching, lesson, preparation, floor);
    setProgress({ index: 0, similarity: 0, frames: 0 });
    setCoachingCue(null);

    if (inputSource !== "fixture") {
      return () => {
        trackerRef.current = null;
        coachingRef.current = null;
      };
    }

    setStudentLandmarks(null);
    let cancelled = false;
    const fixtureUrl = useBadFixture ? FIXTURE_STUDENT_BAD : FIXTURE_STUDENT_GOOD;

    void (async () => {
      const recording = await loadPoseFixture(fixtureUrl, lesson.id);
      if (cancelled) return;

      let frameIndex = 0;
      const tick = () => {
        if (cancelled || frameIndex >= recording.frames.length) {
          return;
        }
        const frame = recording.frames[frameIndex]!;
        frameIndex += 1;
        processStudentFrame(frame);
        replayTimerRef.current = window.setTimeout(tick, 1000 / config.pose.sampleFps);
      };
      tick();
    })();

    return () => {
      cancelled = true;
      if (replayTimerRef.current !== null) {
        window.clearTimeout(replayTimerRef.current);
      }
      trackerRef.current = null;
      coachingRef.current = null;
    };
  }, [apprentice, config, floor, inputSource, lesson, preparation, processStudentFrame, state, useBadFixture]);

  const checkpoints = lesson?.canonicalMovement.checkpoints ?? [];
  const expectedCheckpoint = checkpoints[state === "LEARN_ACTIVE" ? progress.index : 0];
  const teacherLandmarks: Landmark[] | null = useMemo(
    () => ghostLandmarks(expectedCheckpoint, studentLandmarks, config.pose.minimumVisibility),
    [config.pose.minimumVisibility, expectedCheckpoint, studentLandmarks],
  );

  const finishLesson = useCallback(() => {
    if (replayTimerRef.current !== null) {
      window.clearTimeout(replayTimerRef.current);
    }
    cameraManager.releaseAll();
    goTo("LEARN_COMPLETE");
  }, [goTo]);

  if (state === "LEARN_LIBRARY") {
    return <LessonLibrary />;
  }

  if (state === "LEARN_CALIBRATION") {
    return (
      <StudentCalibration
        onComplete={() => goTo("LEARN_START_POSITION")}
        onCancel={() => goTo("LEARN_LIBRARY")}
      />
    );
  }

  if (lessonError) {
    return (
      <div className="flow-panel">
        <p className="error-text">{lessonError}</p>
        <button type="button" className="primary" onClick={() => goTo("HOME")}>
          Home
        </button>
      </div>
    );
  }

  const framing = studentLandmarks ? framingHint(missingJoints(studentLandmarks, floor)) : null;
  const liveStage = (
    <LiveStage stream={liveStream} landmarks={studentLandmarks} ghost={teacherLandmarks} floor={floor} showMissing>
      <span className="ghost-label ghost-student">You</span>
      <span className="ghost-label ghost-teacher">
        {expectedCheckpoint ? `Teacher: ${expectedCheckpoint.progress}% ${expectedCheckpoint.phase}` : "Teacher"}
      </span>
      <SuccessOverlay visible={successVisible || state === "LEARN_SUCCESS"} />
    </LiveStage>
  );
  const poseStatusLine = (
    <p className="muted" data-testid="live-pose-status">
      Pose tracking: {livePoseStatus}
      {livePoseStatus === "running" && !personVisible ? ". Step back into view so your whole body is visible." : ""}
      {livePoseStatus === "running" && personVisible && framing ? `. ${framing}` : ""}
    </p>
  );

  if (state === "LEARN_START_POSITION") {
    if (!lesson) {
      return <p className="muted">Loading lesson...</p>;
    }
    return (
      <div className="flow-panel learn-start">
        <h2>{lesson.name}</h2>
        {!predictionDone ? (
          <>
            <p className="apprentice-message" data-testid="prediction-question">
              {preparation?.predictionQuestion ?? "The apprentice is preparing your first question..."}
            </p>
            <label>
              Your prediction
              <textarea
                value={predictionAnswer}
                onChange={(e) => setPredictionAnswer(e.target.value)}
                rows={3}
              />
            </label>
            <button
              type="button"
              className="primary"
              disabled={!predictionAnswer.trim() || !preparation}
              onClick={() => setPredictionDone(true)}
            >
              Start lesson
            </button>
          </>
        ) : (
          <>
            <p className="muted">
              {inputSource === "fixture"
                ? "Fixture replay stands in for the camera."
                : "Line up your green skeleton with the teacher's orange start position, then begin."}
            </p>
            {inputSource !== "fixture" ? (
              <>
                {liveStage}
                {poseStatusLine}
              </>
            ) : (
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={useBadFixture}
                  onChange={(e) => setUseBadFixture(e.target.checked)}
                />
                Replay student-bad fixture (practice corrections)
              </label>
            )}
            <button type="button" className="primary" onClick={() => goTo("LEARN_ACTIVE")}>
              Begin attempt
            </button>
          </>
        )}
        {cameraError ? <p className="error-text">{cameraError}</p> : null}
        <button type="button" className="secondary" onClick={finishLesson}>
          Finish lesson
        </button>
      </div>
    );
  }

  if (state === "LEARN_ACTIVE" || state === "LEARN_SUCCESS") {
    return (
      <div className="flow-panel learn-active">
        <div className="learn-header">
          <h2>{lesson?.name ?? "Practice"}</h2>
          <button type="button" className="secondary" onClick={finishLesson}>
            Finish lesson
          </button>
        </div>
        {inputSource === "fixture" ? (
          <div className="stage-stack">
            <GhostCoach
              teacherLandmarks={teacherLandmarks}
              studentLandmarks={studentLandmarks}
              teacherLabel={expectedCheckpoint ? `Teacher: ${expectedCheckpoint.progress}% ${expectedCheckpoint.phase}` : "Teacher"}
            />
            <SuccessOverlay visible={successVisible || state === "LEARN_SUCCESS"} />
          </div>
        ) : (
          liveStage
        )}
        <p className="coaching-cue" data-testid="coaching-cue" aria-live="polite">
          {coachingCue ?? (reps > 0 ? `Good rep. ${reps} done.` : "Follow the orange teacher pose through the movement.")}
        </p>
        <p className="muted" data-testid="learn-progress" data-index={progress.index} data-frames={progress.frames}>
          Checkpoint {progress.index + 1} of {checkpoints.length}
          {expectedCheckpoint ? ` (${expectedCheckpoint.progress}% ${expectedCheckpoint.phase})` : ""}, match{" "}
          {Math.round(progress.similarity * 100)}%, reps {reps}
        </p>
        {inputSource !== "fixture" ? poseStatusLine : null}
        {cameraError ? <p className="error-text">{cameraError}</p> : null}
        {livePoseStatus === "error" ? (
          <p className="error-text">Pose tracking could not start. Reload the page or try Pose Fixture input.</p>
        ) : null}
      </div>
    );
  }

  if (state === "LEARN_COMPLETE") {
    return (
      <MasteryReport
        reps={reps}
        corrections={corrections}
        predictionResponse={predictionAnswer}
        onDone={() => {
          cameraManager.releaseAll();
          goTo("HOME");
        }}
      />
    );
  }

  return null;
}
