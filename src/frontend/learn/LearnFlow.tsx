import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../app/AppContext";
import { useApprentice } from "../apprentice/ApprenticeProvider";
import type { LearnPreparation } from "../apprentice/ApprenticeGateway";
import { LearningRun } from "./LearningRun";
import { LearnerVideo } from "./LearnerVideo";
import { buildRuntimeTargets, resolveCanonical } from "../lesson/RuntimeTargets";
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
import {
  loadPoseFixture,
  FIXTURE_STUDENT_GOOD,
  FIXTURE_STUDENT_BAD,
} from "../teach/poseFixtureLoader";
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
  const { state, goTo, inputSource, uploadFile, config, selectedLessonId } = useApp();
  const apprentice = useApprentice();
  const [predictionAnswer, setPredictionAnswer] = useState("");

  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [preparation, setPreparation] = useState<LearnPreparation | null>(null);
  const [predictionDone, setPredictionDone] = useState(false);
  const [useBadFixture, setUseBadFixture] = useState(false);
  const [lessonError, setLessonError] = useState<string | null>(null);
  const [progress, setProgress] = useState<TrackProgress>({ index: 0, similarity: 0, frames: 0 });
  const [studentLandmarks, setStudentLandmarks] = useState<Landmark[] | null>(null);
  const [studentBody, setStudentBody] = useState<
    PoseFrame["bodySkeleton"] | PoseFrame["body3d"] | PoseFrame["articulated3d"]
  >();
  const [coachingCue, setCoachingCue] = useState<string | null>(null);
  const [successVisible, setSuccessVisible] = useState(false);
  const [reps, setReps] = useState(0);
  const [corrections, setCorrections] = useState(0);
  const [quality, setQuality] = useState<number | null>(null);

  const liveStream = useCameraStream();
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [personVisible, setPersonVisible] = useState(true);
  const floor = usabilityFloor(config.pose.minimumVisibility);

  const runRef = useRef<LearningRun | null>(null);
  const uploadRef = useRef<LearnerVideo | null>(null);
  const [uploadVideo, setUploadVideo] = useState<HTMLVideoElement | null>(null);
  const [uploadCalibrated, setUploadCalibrated] = useState(false);
  const [sequenceComplete, setSequenceComplete] = useState(false);
  const finishRef = useRef<(termination: "eof" | "user" | "error") => void>(() => undefined);
  const coachingRef = useRef<CoachingSession | null>(null);
  const replayTimerRef = useRef<number | null>(null);
  const successTimerRef = useRef<number | null>(null);
  const lastTrackedAtRef = useRef(0);

  const processStudentFrame = useCallback(
    async (frame: PoseFrame) => {
      const trackingValid = isUsablePose(frame.landmarks, floor);
      if (trackingValid) {
        lastTrackedAtRef.current = performance.now();
        setPersonVisible(true);
      }
      setStudentLandmarks(frame.landmarks);
      setStudentBody(frame.articulated3d ?? frame.body3d ?? frame.bodySkeleton);
      const run = runRef.current;
      const tracker = run?.tracker;
      const coaching = coachingRef.current;
      if (!tracker || !coaching) return;
      const pose = normalizePose(frame, config.pose.minimumVisibility);
      let event;
      try {
        event = await run!.processFrame(frame);
      } catch (error) {
        setCameraError(String(error));
        finishRef.current("error");
        return;
      }
      if (runRef.current !== run) return;
      const index = tracker.getExpectedIndex();
      const similarity = tracker.lastSimilarity;
      setQuality(run!.matchQualityPercent);
      setProgress((p) =>
        p.index === index && Math.abs(p.similarity - similarity) < 0.02 && p.frames % 15 !== 0
          ? { ...p, frames: p.frames + 1 }
          : { index, similarity, frames: p.frames + 1 },
      );
      if (!event) return;
      if (event.type === "CHECKPOINT_PASSED") {
        setCoachingCue(null);
      }
      if (event.type === "REP_SUCCESS" || event.type === "SEQUENCE_COMPLETE") {
        coaching.resetMismatch();
        setReps(run!.reps);
        setSequenceComplete(run!.sequenceComplete);
        setCoachingCue(null);
        setSuccessVisible(true);
        if (successTimerRef.current !== null) window.clearTimeout(successTimerRef.current);
        successTimerRef.current = window.setTimeout(() => setSuccessVisible(false), 1200);
        return;
      }
      const cue = coaching.handleTrackerEvent(
        pose.timestampMs,
        event,
        pose,
        tracker.getGhostTarget(),
      );
      if (!cue) return;
      DebugBus.emit({
        category: "COACH",
        event: "COACHING_CUE",
        message: cue,
        data: { runId: run!.runId, runtimeTargetIndex: index },
      });
      setCorrections(coaching.correctionCount);
      setCoachingCue(cue);
    },
    [config.pose.minimumVisibility, floor],
  );

  useEffect(
    () => () => {
      if (successTimerRef.current !== null) window.clearTimeout(successTimerRef.current);
    },
    [],
  );

  const liveTracking =
    inputSource === "live" &&
    (state === "LEARN_ACTIVE" || (state === "LEARN_START_POSITION" && predictionDone));
  const livePoseStatus = useLivePose(liveStream, liveTracking, processStudentFrame, {
    fps: config.pose.sampleFps,
    legacy: lesson?.canonicalMovement.schemaVersion !== 3,
    representation: lesson?.canonicalMovement.representation,
  });

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
    setSequenceComplete(false);
    setCorrections(0);
    setQuality(null);
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
        if (!cancelled)
          setLessonError(error instanceof Error ? error.message : "Lesson could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedLessonId]);

  useEffect(() => {
    if (!lesson || preparation || !state.startsWith("LEARN_") || state === "LEARN_LIBRARY")
      return undefined;
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

    const run = new LearningRun(
      lesson,
      config,
      inputSource,
      inputSource === "upload" ? uploadRef.current?.runId : undefined,
    );
    runRef.current = run;
    coachingRef.current = new CoachingSession(
      apprentice,
      config.coaching,
      lesson,
      preparation,
      floor,
      runRef.current.tracker.targets,
    );
    setProgress({ index: 0, similarity: 0, frames: 0 });
    setCoachingCue(null);

    if (inputSource !== "fixture") {
      if (inputSource === "upload")
        void uploadRef.current?.begin().catch((e: unknown) => {
          setCameraError(String(e));
          finishRef.current("error");
        });
      return () => {
        run.finish("cancelled", coachingRef.current?.correctionCount ?? 0);
        runRef.current = null;
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
          if (!cancelled) finishRef.current("eof");
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
      run.finish("cancelled", coachingRef.current?.correctionCount ?? 0);
      cancelled = true;
      if (replayTimerRef.current !== null) {
        window.clearTimeout(replayTimerRef.current);
      }
      runRef.current = null;
      coachingRef.current = null;
    };
  }, [
    apprentice,
    config,
    floor,
    inputSource,
    lesson,
    preparation,
    processStudentFrame,
    state,
    useBadFixture,
  ]);

  const checkpoints = useMemo(
    () =>
      lesson
        ? buildRuntimeTargets(
            resolveCanonical(lesson.canonicalMovement, lesson.demonstrations),
            config.pose.matchDifficulty,
          )
        : [],
    [lesson, config.pose.matchDifficulty],
  );
  const expectedCheckpoint =
    state === "LEARN_ACTIVE" ? runRef.current?.tracker.getGhostTarget() : checkpoints[0];
  const phaseLabel =
    lesson?.canonicalMovement.representation === "mediapipe-articulated-3d-v1"
      ? lesson.canonicalMovement.kind === "cycle"
        ? "Cycle"
        : "Sequence"
      : (expectedCheckpoint?.phase ?? "Start");
  const teacherLandmarks: Landmark[] | null = useMemo(
    () =>
      ghostLandmarks(
        expectedCheckpoint,
        studentLandmarks,
        config.pose.minimumVisibility,
        studentBody,
      ),
    [config.pose.minimumVisibility, expectedCheckpoint, studentLandmarks, studentBody],
  );

  const finishingRef = useRef(false);
  const finishLesson = useCallback(
    async (termination: "eof" | "user" | "error" = "user") => {
      if (finishingRef.current) return;
      finishingRef.current = true;
      if (!runRef.current && lesson)
        runRef.current = new LearningRun(lesson, config, inputSource, uploadRef.current?.runId);
      uploadRef.current?.dispose();
      const summary = await runRef.current?.finishAsync(
        termination,
        coachingRef.current?.correctionCount ?? 0,
      );
      setQuality(summary?.matchQualityPercent ?? null);
      setReps(runRef.current?.reps ?? 0);
      setSequenceComplete(runRef.current?.sequenceComplete ?? false);
      if (replayTimerRef.current !== null) {
        window.clearTimeout(replayTimerRef.current);
      }
      cameraManager.releaseAll();
      goTo("LEARN_COMPLETE");
      finishingRef.current = false;
    },
    [goTo, lesson, config, inputSource],
  );
  finishRef.current = finishLesson;

  const uploadEnabled =
    inputSource === "upload" &&
    state.startsWith("LEARN_") &&
    !["LEARN_LIBRARY", "LEARN_COMPLETE"].includes(state);
  const frameCallbackRef = useRef(processStudentFrame);
  frameCallbackRef.current = processStudentFrame;
  useEffect(() => {
    if (!uploadEnabled || !uploadFile || !lesson) return;
    cameraManager.releaseAll();
    let disposed = false;
    const url = URL.createObjectURL(uploadFile);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    const controller = new LearnerVideo(video, {
      fps: config.pose.sampleFps,
      minimumVisibility: config.pose.minimumVisibility,
      legacy: lesson.canonicalMovement.schemaVersion !== 3,
      representation: lesson.canonicalMovement.representation,
      onFrame: (f) => frameCallbackRef.current(f),
      onCalibrated: (f) => {
        if (disposed) return;
        setUploadCalibrated(true);
        setStudentLandmarks(f.landmarks);
        goTo("LEARN_START_POSITION");
      },
      onComplete: (reason) => {
        if (!disposed) finishRef.current(reason);
      },
      onError: (e) => {
        if (!disposed) setCameraError(e instanceof Error ? e.message : String(e));
      },
    });
    uploadRef.current = controller;
    setUploadVideo(video);
    setUploadCalibrated(false);
    void controller.calibrate().catch((e: unknown) => {
      if (!disposed) {
        setCameraError(String(e));
        finishRef.current("error");
      }
    });
    return () => {
      disposed = true;
      controller.dispose();
      uploadRef.current = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      setUploadVideo(null);
    };
  }, [
    uploadEnabled,
    uploadFile,
    lesson,
    config.pose.sampleFps,
    config.pose.minimumVisibility,
    goTo,
  ]);

  if (state === "LEARN_LIBRARY") {
    return <LessonLibrary />;
  }

  if (state === "LEARN_CALIBRATION") {
    if (inputSource === "upload")
      return (
        <div className="flow-panel">
          <h2>Learn calibration</h2>
          {uploadVideo ? (
            <LiveStage stream={null} videoElement={uploadVideo} floor={floor} />
          ) : null}
          <p>
            {cameraError ??
              (uploadFile ? "Finding a stable body position..." : "Choose a learner video.")}
          </p>
          <button type="button" onClick={() => goTo("LEARN_LIBRARY")}>
            Cancel
          </button>
        </div>
      );
    return (
      <StudentCalibration
        legacy={lesson?.canonicalMovement.schemaVersion !== 3}
        representation={lesson?.canonicalMovement.representation}
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
    <LiveStage
      stream={inputSource === "live" ? liveStream : null}
      videoElement={inputSource === "upload" ? uploadVideo : null}
      landmarks={studentLandmarks}
      ghost={teacherLandmarks}
      ghostFloor={lesson?.canonicalMovement.schemaVersion === 3 ? 0.5 : 0}
      maxRenderDimension={lesson?.canonicalMovement.schemaVersion === 3 ? 960 : Infinity}
      floor={floor}
      showMissing
    >
      <span className="ghost-label ghost-student">You</span>
      <span className="ghost-label ghost-teacher">
        {expectedCheckpoint ? `Teacher: ${phaseLabel}` : "Teacher"}
      </span>
      <SuccessOverlay visible={successVisible || state === "LEARN_SUCCESS"} />
    </LiveStage>
  );
  const trackingStatus =
    inputSource === "upload"
      ? cameraError
        ? "error"
        : state === "LEARN_ACTIVE" && uploadCalibrated
          ? progress.frames > 0
            ? "running"
            : "starting"
          : "idle"
      : livePoseStatus;
  const poseStatusLine = (
    <p className="muted" data-testid="live-pose-status">
      Pose tracking: {trackingStatus}
      {trackingStatus === "running" && !personVisible
        ? ". Step back into view so your whole body is visible."
        : ""}
      {trackingStatus === "running" && personVisible && framing ? `. ${framing}` : ""}
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
              {preparation?.predictionQuestion ??
                "The apprentice is preparing your first question..."}
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
            <button
              type="button"
              className="primary"
              disabled={inputSource === "upload" && !uploadCalibrated}
              onClick={() => goTo("LEARN_ACTIVE")}
            >
              Begin attempt
            </button>
          </>
        )}
        {cameraError ? <p className="error-text">{cameraError}</p> : null}
        <button type="button" className="secondary" onClick={() => finishLesson()}>
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
          <button type="button" className="secondary" onClick={() => finishLesson()}>
            Finish lesson
          </button>
        </div>
        {inputSource === "fixture" ? (
          <div className="stage-stack">
            <GhostCoach
              teacherLandmarks={teacherLandmarks}
              studentLandmarks={studentLandmarks}
              teacherLabel={expectedCheckpoint ? `Teacher: ${phaseLabel}` : "Teacher"}
            />
            <SuccessOverlay visible={successVisible || state === "LEARN_SUCCESS"} />
          </div>
        ) : (
          liveStage
        )}
        <p className="coaching-cue" data-testid="coaching-cue" aria-live="polite">
          {coachingCue ??
            (sequenceComplete
              ? "Sequence complete."
              : reps > 0
                ? `Rep completed. ${reps} done.`
                : "Follow the orange teacher pose through the movement.")}
        </p>
        <p
          className="muted"
          data-testid="learn-progress"
          data-index={progress.index}
          data-frames={progress.frames}
        >
          {phaseLabel},{" "}
          {lesson?.canonicalMovement.representation === "mediapipe-articulated-3d-v1" ? (
            <>
              progress{" "}
              {Math.round(runRef.current?.tracker.diagnostics().currentProgressPercent ?? 0)}%,{" "}
              <span data-testid="movement-quality">
                match quality {quality === null ? "--" : `${Math.round(quality)}%`}
              </span>
              ,
            </>
          ) : (
            <>match {Math.round(progress.similarity * 100)}%,</>
          )}{" "}
          {lesson?.canonicalMovement.kind === "sequence"
            ? sequenceComplete
              ? "sequence complete"
              : "sequence in progress"
            : `reps ${reps}`}
        </p>
        {inputSource !== "fixture" ? poseStatusLine : null}
        {cameraError ? <p className="error-text">{cameraError}</p> : null}
        {livePoseStatus === "error" ? (
          <p className="error-text">
            Pose tracking could not start. Reload the page or try Pose Fixture input.
          </p>
        ) : null}
      </div>
    );
  }

  if (state === "LEARN_COMPLETE") {
    return (
      <MasteryReport
        sequenceComplete={sequenceComplete}
        kind={lesson?.canonicalMovement.kind ?? "cycle"}
        reps={reps}
        corrections={corrections}
        qualityPercent={quality}
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
