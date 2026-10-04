import type { PoseFrame } from "../pose/pose.types";
import { MAJOR_JOINTS, MIN_USABLE_JOINTS, bodyScaleEvidence, usabilityFloor, visibleJointCount } from "../pose/PoseUsability";
import { captureBodyCalibration } from "./BodyCalibration";
import { POSE_LANDMARK } from "../pose/pose.types";
import type {
  CalibrationHealth,
  CalibrationMetricState,
  CalibrationSignals,
  CalibrationState,
} from "./calibration.types";

const CORE_LANDMARKS = [
  POSE_LANDMARK.LEFT_SHOULDER,
  POSE_LANDMARK.RIGHT_SHOULDER,
  POSE_LANDMARK.LEFT_HIP,
  POSE_LANDMARK.RIGHT_HIP,
  POSE_LANDMARK.LEFT_KNEE,
  POSE_LANDMARK.RIGHT_KNEE,
  POSE_LANDMARK.LEFT_ANKLE,
  POSE_LANDMARK.RIGHT_ANKLE,
];

function metric(
  health: CalibrationHealth,
  updatedAtMs: number,
  message?: string,
): CalibrationMetricState {
  return { health, updatedAtMs, message };
}

export class CalibrationMonitor {
  private state: CalibrationState;
  private lostTrackingMs: number;
  private lastGoodScaleAt = Number.NEGATIVE_INFINITY;
  private lastGoodBodyAt = Number.NEGATIVE_INFINITY;
  private readonly minimumVisibility: number;
  /** Inputs behind the last body and scale decision, for diagnostics. */
  lastEvaluation = { visibleJoints: 0, scale: 0 };
  private landmarkLastGood: Record<number, number> = {};

  constructor(lostTrackingMs = 1000, minimumVisibility = 0.5) {
    this.lostTrackingMs = lostTrackingMs;
    this.minimumVisibility = minimumVisibility;
    this.state = {
      camera: metric("lost", 0, "Camera not ready"),
      microphone: metric("lost", 0, "Microphone not ready"),
      fullBody: metric("lost", 0, "Body not tracked"),
      bodyScale: metric("lost", 0, "Scale unknown"),
      landmarks: {},
    };
  }

  getState(): CalibrationState {
    return this.state;
  }

  setLostTrackingMs(ms: number): void {
    this.lostTrackingMs = ms;
  }

  update(frame: PoseFrame | null, signals: CalibrationSignals): CalibrationState {
    const t = frame?.timestampMs ?? signals.nowMs ?? 0;

    this.state.camera = signals.cameraOk
      ? metric("valid", t, "Camera frames OK")
      : metric("lost", t, "No camera frames");

    if (!signals.microphoneLevel && signals.microphoneLevel !== 0) {
      this.state.microphone = metric("lost", t, "No microphone");
    } else if (signals.speechConfirmed) {
      this.state.microphone = metric("valid", t, "Speech confirmed");
    } else if (signals.microphoneLevel > 0.02) {
      this.state.microphone = metric("valid", t, "Audio level OK");
    } else if (signals.microphoneLevel > 0) {
      this.state.microphone = metric("degraded", t, "Low audio level");
    } else {
      this.state.microphone = metric("lost", t, "Silent / no mic");
    }

    const floor = usabilityFloor(this.minimumVisibility);
    const joints = frame && signals.poseModelReady ? visibleJointCount(frame.landmarks, floor) : 0;
    const scale = frame && signals.poseModelReady ? bodyScaleEvidence(frame.landmarks, floor) : { ok: false, scale: 0 };
    this.lastEvaluation = { visibleJoints: joints, scale: scale.scale };

    if (joints >= MIN_USABLE_JOINTS) {
      this.lastGoodBodyAt = t;
      this.state.fullBody = metric("valid", t, `Body visible (${joints} of ${MAJOR_JOINTS.length} joints)`);
    } else {
      const why = joints === 0 ? "No person detected" : `Partial body (${joints} of ${MAJOR_JOINTS.length} joints)`;
      this.state.fullBody = metric(t - this.lastGoodBodyAt <= this.lostTrackingMs ? "degraded" : "lost", t, why);
    }

    if (scale.ok) {
      this.lastGoodScaleAt = t;
      this.state.bodyScale = metric("valid", t, "Body scale measured");
    } else {
      const why = joints === 0 ? "No person detected" : "Shoulder and hip not both visible";
      this.state.bodyScale = metric(t - this.lastGoodScaleAt <= this.lostTrackingMs ? "degraded" : "lost", t, why);
    }

    if (!frame || !signals.poseModelReady) {
      this.state.landmarks = {};
      return this.state;
    }

    const landmarks: Record<number, CalibrationMetricState> = {};
    for (const index of CORE_LANDMARKS) {
      const lm = frame.landmarks[index];
      const vis = lm?.visibility ?? 0;
      if (vis >= 0.65) {
        this.landmarkLastGood[index] = t;
        landmarks[index] = metric("valid", t);
      } else if (t - (this.landmarkLastGood[index] ?? 0) < this.lostTrackingMs) {
        landmarks[index] = metric("degraded", t, "Temporarily low visibility");
      } else {
        landmarks[index] = metric("lost", t, "Landmark lost");
      }
    }
    this.state.landmarks = landmarks;

    if (this.state.fullBody.health === "valid" && this.state.bodyScale.health === "valid") {
      this.state.body = captureBodyCalibration(frame);
    }

    return this.state;
  }

  /** Body and scale are usable now or were within the grace period. */
  bodyReady(): boolean {
    return this.state.fullBody.health !== "lost" && this.state.bodyScale.health !== "lost";
  }

  isReadyForTeach(): boolean {
    return (
      this.state.camera.health === "valid" &&
      this.state.microphone.health !== "lost" &&
      this.state.fullBody.health === "valid" &&
      this.state.bodyScale.health === "valid"
    );
  }

  isReadyForLearn(): boolean {
    return (
      this.state.camera.health === "valid" &&
      this.state.fullBody.health === "valid" &&
      this.state.bodyScale.health === "valid"
    );
  }

  trackingValid(requiredLandmarks: number[]): boolean {
    return requiredLandmarks.every((index) => this.state.landmarks[index]?.health === "valid");
  }
}
