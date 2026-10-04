import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../app/AppContext";
import { DebugBus } from "../debug/DebugBus";
import { cameraErrorMessage, cameraManager, isSupersededError } from "../media/CameraManager";
import { useCameraStream } from "../media/useCamera";
import { LiveStage } from "../components/LiveStage";
import { useLivePose } from "../pose/useLivePose";
import { JOINT_NAMES, framingHint, missingJoints, usabilityFloor } from "../pose/PoseUsability";
import type { Landmark, PoseFrame } from "../pose/pose.types";
import { confirmCalibrationPhrase, measureMicrophoneLevel } from "./MicrophoneCalibration";
import { CalibrationMonitor } from "./CalibrationMonitor";
import type { CalibrationHealth, CalibrationMetricState } from "./calibration.types";

interface Props {
  mode: "teach" | "learn";
  onComplete: () => void;
  onCancel: () => void;
}

interface BodyMetrics {
  fullBody: CalibrationMetricState;
  bodyScale: CalibrationMetricState;
}

const NO_POSE: CalibrationMetricState = { health: "lost", updatedAtMs: 0, message: "Waiting for pose" };

/** Body and scale must hold valid this long once; later dropouts no longer block Continue. */
const BODY_CAPTURE_HOLD_MS = 1000;

function checkClass(health: CalibrationHealth | boolean): string {
  if (health === true || health === "valid") return "ok";
  if (health === "degraded") return "degraded";
  return "";
}

export function CalibrationFlow({ mode, onComplete, onCancel }: Props) {
  const { config, inputSource } = useApp();
  const [monitor] = useState(
    () => new CalibrationMonitor(config.calibration.lostTrackingMs, config.pose.minimumVisibility),
  );
  /** Upload teaching measures the body from the video; fixtures replay recorded poses. */
  const uploadTeach = inputSource === "upload" && mode === "teach";
  const bypassDevices = inputSource === "fixture" || uploadTeach;
  const floor = usabilityFloor(config.pose.minimumVisibility);
  const [camera, setCamera] = useState(false);
  const [microphone, setMicrophone] = useState(mode === "learn");
  const [speech, setSpeech] = useState(mode === "learn");
  const [micChecked, setMicChecked] = useState(false);
  const [videoOnly, setVideoOnly] = useState(false);
  const [body, setBody] = useState<BodyMetrics>({ fullBody: NO_POSE, bodyScale: NO_POSE });
  const [landmarks, setLandmarks] = useState<Landmark[] | null>(null);
  const [bodyCaptured, setBodyCaptured] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const stream = useCameraStream();
  const firstPoseRef = useRef(false);
  const everValidRef = useRef(false);
  const validSinceRef = useRef<number | null>(null);
  const capturedRef = useRef(false);
  const lastFrameAtRef = useRef(0);
  const healthRef = useRef<BodyMetrics>({ fullBody: NO_POSE, bodyScale: NO_POSE });
  const completedRef = useRef(false);

  const complete = useCallback(() => {
    if (completedRef.current) return;
    completedRef.current = true;
    DebugBus.emit({
      category: "CALIBRATION",
      event: "CALIBRATION_COMPLETE",
      data: bypassDevices
        ? { mode, inputSource, bypassed: true }
        : {
            mode,
            inputSource,
            fullBody: healthRef.current.fullBody.health,
            bodyScale: healthRef.current.bodyScale.health,
            bodyCaptured: capturedRef.current,
            ...monitor.lastEvaluation,
          },
    });
    onComplete();
  }, [bypassDevices, inputSource, mode, monitor, onComplete]);
  const completeRef = useRef(complete);
  completeRef.current = complete;

  useEffect(() => {
    if (bypassDevices) {
      DebugBus.emit({ category: "CALIBRATION", event: "CALIBRATION_DEVICE_BYPASS", data: { mode, inputSource } });
      if (uploadTeach) completeRef.current();
      return undefined;
    }
    let cancelled = false;
    void (async () => {
      try {
        await cameraManager
          .ensure({ video: true, audio: mode === "teach" })
          .catch((error: unknown) => {
            if (cancelled || isSupersededError(error)) throw error;
            return cameraManager.ensure({ video: true, audio: false });
          });
      } catch (error) {
        if (!cancelled && !isSupersededError(error)) setDeviceError(cameraErrorMessage(error));
        return;
      }
      if (cancelled) return;
      setDeviceError(null);
      setCamera(cameraManager.isVideoLive());
      if (mode === "teach") {
        const mic = await measureMicrophoneLevel();
        if (cancelled) return;
        setMicrophone(mic.available);
        setMicChecked(true);
        DebugBus.emit({
          category: "CALIBRATION",
          event: "CALIBRATION_MICROPHONE",
          data: { available: mic.available, peakRms: mic.peakRms },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bypassDevices, inputSource, mode, uploadTeach]);

  useEffect(() => {
    if (bypassDevices) return;
    setCamera(cameraManager.isVideoLive());
  }, [bypassDevices, stream]);

  const publish = useCallback(
    (frameReceived: boolean, nowMs: number) => {
      const state = monitor.getState();
      const next: BodyMetrics = { fullBody: state.fullBody, bodyScale: state.bodyScale };
      const prev = healthRef.current;
      for (const key of ["fullBody", "bodyScale"] as const) {
        if (prev[key].health === next[key].health) continue;
        const recovered = next[key].health === "valid" && everValidRef.current;
        DebugBus.emit({
          category: "CALIBRATION",
          level: next[key].health === "lost" ? "warn" : "info",
          event: recovered ? "CALIBRATION_RECOVERED" : `CALIBRATION_${next[key].health.toUpperCase()}`,
          message: next[key].message,
          data: { metric: key, from: prev[key].health, to: next[key].health, frameReceived, ...monitor.lastEvaluation },
        });
      }
      const bothValid = next.fullBody.health === "valid" && next.bodyScale.health === "valid";
      if (bothValid) everValidRef.current = true;
      validSinceRef.current = bothValid ? (validSinceRef.current ?? nowMs) : null;
      if (!capturedRef.current && validSinceRef.current !== null && nowMs - validSinceRef.current >= BODY_CAPTURE_HOLD_MS) {
        capturedRef.current = true;
        setBodyCaptured(true);
        DebugBus.emit({ category: "CALIBRATION", event: "CALIBRATION_BODY_CAPTURED", data: { mode, ...monitor.lastEvaluation } });
      }
      if (prev.fullBody.health !== next.fullBody.health || prev.bodyScale.health !== next.bodyScale.health) {
        healthRef.current = next;
        setBody(next);
      }
    },
    [mode, monitor],
  );

  const onPose = useCallback(
    (frame: PoseFrame) => {
      const now = performance.now();
      lastFrameAtRef.current = now;
      if (!firstPoseRef.current) {
        firstPoseRef.current = true;
        DebugBus.emit({ category: "CALIBRATION", event: "CALIBRATION_POSE_RECEIVED", data: { mode } });
      }
      setLandmarks(frame.landmarks);
      monitor.update(frame, { cameraOk: true, microphoneLevel: 0, poseModelReady: true });
      publish(true, now);
    },
    [mode, monitor, publish],
  );

  const poseStatus = useLivePose(stream, !bypassDevices && camera, onPose, { fps: config.pose.sampleFps });

  useEffect(() => {
    if (poseStatus !== "running") return undefined;
    const timer = window.setInterval(() => {
      const now = performance.now();
      if (now - lastFrameAtRef.current < config.calibration.lostTrackingMs / 2) return;
      setLandmarks(null);
      monitor.update(null, { cameraOk: true, microphoneLevel: 0, poseModelReady: true, nowMs: now });
      publish(false, now);
    }, 250);
    return () => window.clearInterval(timer);
  }, [config.calibration.lostTrackingMs, monitor, poseStatus, publish]);

  const confirmSpeech = () => {
    const ok = confirmCalibrationPhrase(phrase);
    setSpeech(ok);
    DebugBus.emit({ category: "CALIBRATION", event: "SPEECH_CALIBRATION", data: { ok } });
  };

  if (uploadTeach) return <p className="muted">Using the uploaded video. Body measurements come from the video itself.</p>;

  const bodyNow = body.fullBody.health !== "lost" && body.bodyScale.health !== "lost";
  const bodyOk = bypassDevices || bodyCaptured || bodyNow;
  const ready = (bypassDevices || (camera && (microphone || videoOnly))) && bodyOk && speech;
  const bodyLabel = (m: CalibrationMetricState) => (m.message ? ` (${m.message})` : "");
  const missing = landmarks ? missingJoints(landmarks, floor) : [];
  const hint = landmarks ? framingHint(missing) : poseStatus === "running" ? "Step into the camera view." : null;

  return (
    <div className="calibration-flow flow-panel">
      <h2>{mode === "teach" ? "Teach calibration" : "Learn calibration"}</h2>
      {bypassDevices ? (
        <p className="muted">Pose fixture mode: device checks are skipped.</p>
      ) : (
        <>
          <LiveStage stream={stream} landmarks={landmarks} floor={floor} showMissing />
          <p className="muted" data-testid="calibration-pose-status">
            Pose tracking: {poseStatus}
            {bodyCaptured ? ". Body captured." : ""}
          </p>
          {poseStatus === "running" && hint && !bodyCaptured ? (
            <div className="framing-guide" data-testid="framing-guide">
              <p>{hint}</p>
              {missing.length ? (
                <p className="muted">
                  Not visible yet: {missing.map((j) => JOINT_NAMES[j] ?? `joint ${j}`).join(", ")}. Green dots are
                  tracked; red rings are joints the camera is unsure about.
                </p>
              ) : null}
            </div>
          ) : null}
        </>
      )}
      {deviceError ? <p className="error-text">{deviceError}</p> : null}
      {mode === "teach" && !bypassDevices && micChecked && !microphone ? (
        <div data-testid="microphone-unavailable">
          <p className="error-text">
            Microphone unavailable. Allow microphone access so your narration can be recorded, or continue video
            only.
          </p>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={videoOnly}
              onChange={(e) => {
                setVideoOnly(e.target.checked);
                DebugBus.emit({ category: "CALIBRATION", event: "CALIBRATION_VIDEO_ONLY", data: { enabled: e.target.checked } });
              }}
            />
            Continue video only (no narration will be recorded or transcribed)
          </label>
        </div>
      ) : null}
      {poseStatus === "error" ? (
        <p className="error-text">Pose model could not load. Reload the page, or choose Upload video.</p>
      ) : null}
      {bypassDevices ? null : (
        <ul className="calibration-checks" data-testid="calibration-checks">
          <li className={checkClass(camera)}>Camera</li>
          {mode === "teach" ? <li className={checkClass(microphone)}>Microphone</li> : null}
          <li className={checkClass(body.fullBody.health)} data-health={body.fullBody.health} data-testid="check-full-body">
            Body visible{bodyLabel(body.fullBody)}
          </li>
          <li className={checkClass(body.bodyScale.health)} data-health={body.bodyScale.health} data-testid="check-body-scale">
            Body scale{bodyLabel(body.bodyScale)}
          </li>
          {mode === "teach" ? <li className={checkClass(speech)}>Speech phrase</li> : null}
        </ul>
      )}
      {mode === "teach" ? (
        <div className="speech-row">
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            placeholder='Say or type: "blue river seven"'
          />
          <button type="button" onClick={confirmSpeech}>
            Confirm phrase
          </button>
        </div>
      ) : null}
      <div className="home-actions">
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="primary" disabled={!ready} onClick={complete}>
          Continue
        </button>
      </div>
    </div>
  );
}
