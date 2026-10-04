import type { SessionTimeMs } from "../clock/clock.types";
import type { BodyCalibration } from "../pose/pose.types";

export type CalibrationHealth = "valid" | "degraded" | "lost";

export interface CalibrationMetricState {
  health: CalibrationHealth;
  updatedAtMs: SessionTimeMs;
  message?: string;
}

export interface CalibrationState {
  camera: CalibrationMetricState;
  microphone: CalibrationMetricState;
  fullBody: CalibrationMetricState;
  bodyScale: CalibrationMetricState;
  landmarks: Record<number, CalibrationMetricState>;
  body?: BodyCalibration;
}

export interface CalibrationSignals {
  cameraOk: boolean;
  microphoneLevel: number;
  speechConfirmed?: boolean;
  poseModelReady: boolean;
  /** Clock reading used when no pose frame arrived, so grace periods still expire. */
  nowMs?: number;
}
