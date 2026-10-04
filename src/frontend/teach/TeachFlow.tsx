import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../app/AppContext";
import { analyzeTeachingSession } from "../analyze/SessionAnalyzer";
import { enrichAnalysisWithTeaching } from "../analyze/TeachingEnrichment";
import { useApprentice } from "../apprentice/ApprenticeProvider";
import { classifyDemonstrationManually } from "../analyze/CycleAnalyzer";
import { CalibrationFlow } from "../calibration/CalibrationFlow";
import { captureBodyCalibration } from "../calibration/BodyCalibration";
import { RuntimeConfigManager } from "../config/RuntimeConfig";
import { DebugBus } from "../debug/DebugBus";
import { RealSessionClock } from "../clock/SessionClock";
import { cameraErrorMessage, cameraManager, isSupersededError } from "../media/CameraManager";
import { useCameraStream } from "../media/useCamera";
import { useObjectUrl } from "../media/useObjectUrl";
import { LiveMediaSource } from "../media/LiveMediaSource";
import { UploadedMediaSource } from "../media/UploadedMediaSource";
import { onUploadCommit } from "../media/uploadCommit";
import { VideoRecorder } from "../media/VideoRecorder";
import { LiveStage } from "../components/LiveStage";
import { VideoViewport } from "../components/VideoViewport";
import { PoseRecorder } from "../pose/PoseRecorder";
import { useLivePose } from "../pose/useLivePose";
import { normalizePose } from "../pose/PoseNormalizer";
import { framingHint, missingJoints, usabilityFloor } from "../pose/PoseUsability";
import type { Demonstration, Landmark } from "../pose/pose.types";
import { SkillSetup } from "./SkillSetup";
import { RecordingControls } from "./RecordingControls";
import { RecordingReview } from "./RecordingReview";
import { useTeachPipeline } from "./TeachPipelineContext";
import { FIXTURE_TEACHER_POSE, loadPoseFixture } from "./poseFixtureLoader";
import { LiveInterviewer, liveVoice, type InterviewView } from "../apprentice/LiveInterview";
import { LiveInterviewCard } from "./LiveInterviewCard";
import { buildFixtureTeachingCapture } from "./fixtureRecording";
import { syntheticReferenceFrame, syntheticReferencePose } from "./syntheticPose";

function formatClock(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function mergeDemonstrationClassifications(
  analyzed: Demonstration[],
  reviewed: Demonstration[],
): Demonstration[] {
  if (reviewed.length === 0) return analyzed;
  const byWindow = reviewed.map((r) => ({ ...r }));
  return analyzed.map((demo, i) => {
    const match = byWindow[i];
    if (!match || match.classification === "unknown") return demo;
    return classifyDemonstrationManually(demo, match.classification);
  });
}

export function TeachFlow() {
  const { state, goTo, inputSource, uploadFile, config } = useApp();
  const apprentice = useApprentice();
  const {
    session,
    setSession,
    pendingDemonstrations,
    setPendingDemonstrations,
    setAnalysis,
  } = useTeachPipeline();

  const [recording, setRecording] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisStage, setAnalysisStage] = useState<string | null>(null);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [captureNotice, setCaptureNotice] = useState<string | null>(null);
  const [livePoseFrames, setLivePoseFrames] = useState(0);
  const [liveLandmarks, setLiveLandmarks] = useState<Landmark[] | null>(null);
  const stream = useCameraStream();
  const uploadPreviewUrl = useObjectUrl(inputSource === "upload" ? uploadFile : null);
  const floor = usabilityFloor(config.pose.minimumVisibility);

  const videoRecorderRef = useRef<VideoRecorder | null>(null);
  const poseRecorderRef = useRef<PoseRecorder | null>(null);
  const clockRef = useRef<RealSessionClock | null>(null);
  const interviewerRef = useRef<LiveInterviewer | null>(null);
  const [interview, setInterview] = useState<InterviewView | null>(null);
  const [recordingMs, setRecordingMs] = useState(0);
  /** Upload teaching runs capture and analysis back to back after one click. */
  const autoAnalyzeRef = useRef(false);

  useEffect(() => {
    if (state === "TEACH_RECORDING") return undefined;
    const recorder = videoRecorderRef.current;
    if (recorder?.isRecording()) {
      void recorder.stop().catch(() => undefined);
      clockRef.current?.stop();
      interviewerRef.current?.stop();
      interviewerRef.current = null;
      setInterview(null);
      setRecording(false);
      DebugBus.emit({ category: "MEDIA", event: "LIVE_RECORDING_ABANDONED" });
    }
    return undefined;
  }, [state]);

  useEffect(
    () => () => {
      if (videoRecorderRef.current?.isRecording()) void videoRecorderRef.current.stop().catch(() => undefined);
      interviewerRef.current?.stop();
    },
    [],
  );

  useEffect(() => {
    if (!recording || inputSource !== "live") return undefined;
    const timer = window.setInterval(() => {
      const now = clockRef.current?.now() ?? 0;
      setRecordingMs(now);
      interviewerRef.current?.tick(now);
    }, 500);
    return () => window.clearInterval(timer);
  }, [inputSource, recording]);

  const liveFraming = inputSource === "live" && (state === "TEACH_READY" || state === "TEACH_RECORDING");
  const livePoseStatus = useLivePose(
    stream,
    liveFraming,
    (frame) => {
      setLiveLandmarks(frame.landmarks);
      const recorder = poseRecorderRef.current;
      if (!recorder || !videoRecorderRef.current?.isRecording()) return;
      recorder.add(frame);
      interviewerRef.current?.observe(frame.timestampMs, frame.landmarks);
      if (recorder.count() % 15 === 0) setLivePoseFrames(recorder.count());
    },
    { fps: config.pose.sampleFps, now: () => clockRef.current?.now() ?? 0 },
  );

  useEffect(() => {
    if (!liveFraming) setLiveLandmarks(null);
  }, [liveFraming]);

  useEffect(() => {
    if (!liveFraming) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        await cameraManager.ensure({ video: true, audio: true });
      } catch (first) {
        if (cancelled || isSupersededError(first)) return;
        try {
          await cameraManager.ensure({ video: true, audio: false });
          if (cancelled) return;
          setCaptureNotice("Microphone unavailable. Video will record without narration.");
        } catch (error) {
          if (!cancelled && !isSupersededError(error)) setCaptureError(cameraErrorMessage(error));
        }
      }
    })();
    return () => {
      cancelled = true;
      setCaptureNotice(null);
    };
  }, [liveFraming]);

  const captureReferenceFromFixture = useCallback(async () => {
    try {
      const poseRecording = await loadPoseFixture(FIXTURE_TEACHER_POSE, session.id);
      const frame = poseRecording.frames[0] ?? syntheticReferenceFrame();
      const calibration = captureBodyCalibration(frame);
      const referencePose = normalizePose(frame);
      setSession((s) => ({ ...s, calibration, referencePose }));
      DebugBus.emit({ category: "APP", event: "REFERENCE_CAPTURED", data: { source: "fixture" } });
    } catch {
      const frame = syntheticReferenceFrame();
      setSession((s) => ({
        ...s,
        calibration: captureBodyCalibration(frame),
        referencePose: syntheticReferencePose(),
      }));
    }
  }, [session.id, setSession]);

  const startRecording = useCallback(async () => {
    setCaptureError(null);
    setRecording(true);
    setPendingDemonstrations([]);

    if (inputSource === "fixture") {
      try {
        const poseRecording = await loadPoseFixture(FIXTURE_TEACHER_POSE, session.id);
        const result = await buildFixtureTeachingCapture(
          poseRecording,
          session.referencePose,
          "motion-cycle-a/teacher",
        );
        setSession((s) => ({ ...s, media: result.media }));
        setPendingDemonstrations(result.demonstrations);
        setRecording(false);
        goTo("TEACH_RECORDING_REVIEW");
      } catch (error) {
        setCaptureError(error instanceof Error ? error.message : "Fixture capture failed");
        setRecording(false);
      }
      return;
    }

    if (inputSource === "upload") {
      if (!uploadFile) {
        setCaptureError("Choose a video in the side panel first.");
        setRecording(false);
        autoAnalyzeRef.current = false;
        return;
      }
      try {
        const media = await new UploadedMediaSource(uploadFile).produce();
        setSession((s) => ({ ...s, media }));
        setRecording(false);
        goTo("TEACH_RECORDING_REVIEW");
      } catch (error) {
        setCaptureError(error instanceof Error ? error.message : "Upload failed");
        setRecording(false);
        autoAnalyzeRef.current = false;
      }
      return;
    }

    const activeStream = stream ?? cameraManager.getStream();
    if (!activeStream) {
      setCaptureError("Camera not ready.");
      setRecording(false);
      return;
    }
    videoRecorderRef.current = new VideoRecorder();
    poseRecorderRef.current = new PoseRecorder(session.id);
    setLivePoseFrames(0);
    setRecordingMs(0);
    setSession((s) => ({ ...s, liveInterview: undefined }));
    clockRef.current = new RealSessionClock();
    clockRef.current.start();
    videoRecorderRef.current.start(activeStream);
    if (apprentice.mode === "elevenlabs") {
      interviewerRef.current = new LiveInterviewer({
        channel: liveVoice,
        skillName: session.lessonName,
        floor,
        onChange: setInterview,
      });
      interviewerRef.current.start();
    }
    DebugBus.emit({ category: "MEDIA", event: "LIVE_RECORDING_STARTED" });
  }, [
    apprentice.mode,
    floor,
    goTo,
    inputSource,
    session.id,
    session.lessonName,
    session.referencePose,
    setPendingDemonstrations,
    setSession,
    stream,
    uploadFile,
  ]);

  const analyzeUpload = useCallback(() => {
    autoAnalyzeRef.current = true;
    goTo("TEACH_RECORDING");
  }, [goTo]);

  useEffect(() => {
    if (inputSource !== "upload") return undefined;
    if (state === "TEACH_READY") return onUploadCommit(analyzeUpload);
    if (state === "TEACH_RECORDING") return onUploadCommit(() => void startRecording());
    return undefined;
  }, [analyzeUpload, inputSource, startRecording, state]);

  const startRecordingRef = useRef(startRecording);
  startRecordingRef.current = startRecording;
  useEffect(() => {
    if (state !== "TEACH_RECORDING" || inputSource !== "upload" || !autoAnalyzeRef.current || recording) return;
    void startRecordingRef.current();
  }, [inputSource, recording, state]);

  const stopRecording = useCallback(async () => {
    if (inputSource !== "live") return;
    setRecording(false);
    try {
      const recorder = videoRecorderRef.current;
      const poseRecorder = poseRecorderRef.current;
      const clock = clockRef.current;
      if (!recorder || !poseRecorder || !clock) {
        throw new Error("Recorder not initialized");
      }
      const video = await recorder.stop();
      clock.stop();
      const durationMs = clock.now();
      const poseRecording = poseRecorder.toRecording();
      const liveInterview = interviewerRef.current?.stop();
      interviewerRef.current = null;
      setInterview(null);
      DebugBus.emit({
        category: "MEDIA",
        event: "LIVE_RECORDING_STOPPED",
        data: {
          durationMs,
          poseFrames: poseRecording.frames.length,
          videoBytes: video.size,
          liveAnswers: liveInterview?.entries.length ?? 0,
        },
      });
      const media = await new LiveMediaSource(video, poseRecording, durationMs).produce();
      setSession((s) => ({ ...s, media, liveInterview }));
      goTo("TEACH_RECORDING_REVIEW");
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : "Stop recording failed");
    }
  }, [goTo, inputSource, setSession]);

  /**
   * Transcription, pose analysis and apprentice extraction in order. Each
   * stage is shown to the expert; a transcription failure continues with
   * movement and answers only.
   */
  const runAnalysis = useCallback(async () => {
    autoAnalyzeRef.current = false;
    if (!session.media) {
      setCaptureError("No teaching media to analyze.");
      return;
    }
    setAnalyzing(true);
    setCaptureError(null);
    goTo("TEACH_ANALYZING");
    try {
      let transcript = undefined;
      let transcriptFailed = false;
      if (session.media.video) {
        setAnalysisStage("Transcribing your narration...");
        const { transcribeMediaBlob } = await import("../analyze/transcribeClient");
        const filename =
          session.media.sourceName ||
          (session.media.video instanceof File ? session.media.video.name : "teaching-media.bin");
        try {
          transcript = await transcribeMediaBlob(session.media.video, filename);
        } catch (error) {
          transcriptFailed = true;
          DebugBus.emit({
            category: "TRANSCRIPT",
            level: "warn",
            event: "TRANSCRIBE_OPTIONAL_FAILED",
            message: error instanceof Error ? error.message : "Transcription failed",
          });
        }
      }

      setAnalysisStage(session.media.poseRecording?.frames.length ? "Finding repetitions..." : "Reading body poses...");
      const raw = await analyzeTeachingSession(session.media, {
        sessionId: session.id,
        referencePose: session.referencePose,
        transcript,
        configSnapshot: RuntimeConfigManager.snapshot(),
        onPoseProgress: (fraction) => setAnalysisStage(`Reading body poses... ${Math.round(fraction * 100)}%`),
      });
      const demonstrations = mergeDemonstrationClassifications(
        raw.demonstrations,
        pendingDemonstrations,
      );
      setAnalysisStage(
        apprentice.mode === "elevenlabs"
          ? "Apprentice is studying what you said and showed..."
          : "Lining up your narration with the movement...",
      );
      const enriched = await enrichAnalysisWithTeaching(
        { ...raw, demonstrations },
        apprentice,
        RuntimeConfigManager.get(),
        session.liveInterview?.windows,
      );
      setSession((s) =>
        s.media ? { ...s, media: { ...s.media, poseRecording: raw.poseRecording } } : s,
      );
      setAnalysis(enriched);
      goTo(
        "TEACH_QUESTIONS",
        transcriptFailed
          ? "Narration could not be transcribed. The lesson will use the movement and your answers only."
          : undefined,
      );
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : "Analysis failed");
      goTo("TEACH_RECORDING_REVIEW");
    } finally {
      setAnalyzing(false);
      setAnalysisStage(null);
    }
  }, [
    apprentice,
    goTo,
    pendingDemonstrations,
    session.id,
    session.liveInterview?.windows,
    session.media,
    session.referencePose,
    setAnalysis,
    setSession,
  ]);

  useEffect(() => {
    if (state === "TEACH_RECORDING_REVIEW" && autoAnalyzeRef.current && session.media) void runAnalysis();
  }, [runAnalysis, session.media, state]);

  const classifyDemo = useCallback(
    (id: string, classification: Demonstration["classification"]) => {
      setPendingDemonstrations((list) =>
        list.map((d) => (d.id === id ? classifyDemonstrationManually(d, classification) : d)),
      );
    },
    [setPendingDemonstrations],
  );

  const liveHint = liveLandmarks ? framingHint(missingJoints(liveLandmarks, floor)) : null;
  const liveRecording = recording && inputSource === "live";
  const liveStage = (
    <>
      <LiveStage stream={stream ?? cameraManager.getStream()} landmarks={liveLandmarks} floor={floor} showMissing>
        {liveRecording ? (
          <div className="rec-badge" data-testid="rec-badge">
            <span className="rec-dot" aria-hidden="true" />
            REC {formatClock(recordingMs)}
          </div>
        ) : null}
        {liveRecording && interview ? <LiveInterviewCard view={interview} /> : null}
      </LiveStage>
      <p className="muted" data-testid="live-pose-status">
        Pose tracking: {livePoseStatus}
        {recording ? `, ${livePoseFrames} frames recorded` : ""}
        {livePoseStatus === "error" ? " (poses will be extracted from the recorded video)" : ""}
        {liveHint ? `. ${liveHint}` : ""}
      </p>
    </>
  );

  if (state === "TEACH_CALIBRATION") {
    return (
      <CalibrationFlow
        mode="teach"
        onComplete={() => goTo("TEACH_SETUP")}
        onCancel={() => goTo("HOME")}
      />
    );
  }

  if (state === "TEACH_SETUP") {
    return (
      <SkillSetup
        initialName={session.lessonName}
        initialImportantThings={session.importantThings}
        onContinue={(name, importantThings) => {
          setSession((s) => ({ ...s, lessonName: name, importantThings }));
          goTo("TEACH_READY");
        }}
        onCancel={() => goTo("HOME")}
      />
    );
  }

  if (state === "TEACH_READY") {
    if (inputSource === "upload") {
      return (
        <div className="flow-panel teach-ready">
          <h2>Teach from your video</h2>
          {uploadPreviewUrl ? (
            <div className="stage-stack">
              <VideoViewport srcObjectUrl={uploadPreviewUrl} />
            </div>
          ) : null}
          <p className="muted">
            {uploadFile
              ? `${uploadFile.name}: SkillPrint will transcribe your narration, read your body poses frame by frame, and then ask you about what it could not work out.`
              : "Choose a video in the side panel first."}
          </p>
          <div className="home-actions">
            <button type="button" className="primary" disabled={!uploadFile} onClick={analyzeUpload}>
              Analyze this video
            </button>
          </div>
        </div>
      );
    }
    return (
      <div className="flow-panel teach-ready">
        <h2>Ready to demonstrate</h2>
        {inputSource === "live" ? (
          <>
            <p className="muted">
              Frame yourself so the green skeleton covers your whole body, then record. Narrate as you go: say what
              you are doing and why.
            </p>
            <p className="interview-note" data-testid="live-interview-note">
              {apprentice.mode === "elevenlabs"
                ? "While you record, the apprentice will ask a few short questions out loud. Answer aloud; your replies are saved and you review them after recording."
                : "Switch the Apprentice to ElevenLabs to get spoken clarifying questions while you record."}
            </p>
            {liveStage}
          </>
        ) : (
          <p className="muted">Capture a fixture reference pose, then replay the fixture as a teaching session.</p>
        )}
        <div className="home-actions">
          {inputSource === "fixture" ? (
            <button type="button" onClick={() => void captureReferenceFromFixture()}>
              Capture reference pose
            </button>
          ) : null}
          <button type="button" className="primary" onClick={() => goTo("TEACH_RECORDING")}>
            Start recording
          </button>
        </div>
        {captureNotice ? <p className="muted">{captureNotice}</p> : null}
        {captureError ? <p className="error-text">{captureError}</p> : null}
      </div>
    );
  }

  if (state === "TEACH_RECORDING") {
    return (
      <div className="flow-panel teach-recording">
        <h2>{inputSource === "upload" ? "Loading video" : "Recording"}</h2>
        {inputSource === "live" ? liveStage : null}
        {inputSource === "upload" ? (
          <p className="muted">
            {uploadFile ? `Teaching video: ${uploadFile.name}` : "Choose a video in the side panel first."}
          </p>
        ) : null}
        {inputSource === "fixture" ? (
          <p className="muted">Fixture replay will simulate a live teaching capture.</p>
        ) : null}
        <RecordingControls
          recording={recording && inputSource === "live"}
          startLabel={inputSource === "upload" ? "Use this video" : undefined}
          onStart={() => void startRecording()}
          onStop={() => void stopRecording()}
          disabled={
            (inputSource !== "live" && recording) ||
            (inputSource === "upload" && !uploadFile) ||
            (inputSource === "live" && !stream && !captureError)
          }
        />
        {inputSource === "live" && !stream && !captureError ? <p className="muted">Starting camera...</p> : null}
        {captureNotice ? <p className="muted">{captureNotice}</p> : null}
        {captureError ? <p className="error-text">{captureError}</p> : null}
        <button type="button" className="secondary" onClick={() => goTo("TEACH_READY")}>
          Back
        </button>
      </div>
    );
  }

  if (state === "TEACH_RECORDING_REVIEW" || state === "TEACH_ANALYZING") {
    return (
      <RecordingReview
        demonstrations={pendingDemonstrations}
        onClassify={classifyDemo}
        onAnalyze={() => void runAnalysis()}
        onRerecord={() => goTo("TEACH_RECORDING")}
        analyzing={analyzing || state === "TEACH_ANALYZING"}
        analysisStage={analysisStage}
        error={captureError}
        source={inputSource}
        video={session.media?.video}
        lessonName={session.lessonName}
      />
    );
  }

  if (state === "TEACH_COMPLETE") {
    return (
      <div className="flow-panel teach-complete">
        <h2>Lesson saved</h2>
        <p>Your skill is ready for learners.</p>
        <div className="home-actions">
          <button type="button" className="primary" onClick={() => goTo("HOME")}>
            Home
          </button>
          <button type="button" className="secondary" onClick={() => goTo("LEARN_LIBRARY")}>
            Learn a skill
          </button>
        </div>
      </div>
    );
  }

  return null;
}
