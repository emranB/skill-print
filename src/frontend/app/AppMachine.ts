import { DebugBus } from "../debug/DebugBus";
import type { AppState } from "./app.types";

const TRANSITIONS: Record<AppState, readonly AppState[]> = {
  HOME: ["TEACH_CALIBRATION", "LEARN_LIBRARY", "TEACH_EDITING", "ERROR"],
  TEACH_CALIBRATION: ["TEACH_SETUP", "HOME", "ERROR"],
  TEACH_SETUP: ["TEACH_READY", "HOME", "ERROR"],
  TEACH_READY: ["TEACH_RECORDING", "HOME", "ERROR"],
  TEACH_RECORDING: ["TEACH_RECORDING_REVIEW", "TEACH_READY", "HOME", "ERROR"],
  TEACH_RECORDING_REVIEW: ["TEACH_RECORDING", "TEACH_ANALYZING", "HOME", "ERROR"],
  TEACH_ANALYZING: ["TEACH_QUESTIONS", "TEACH_LESSON_REVIEW", "ERROR"],
  TEACH_QUESTIONS: ["TEACH_LESSON_REVIEW", "HOME", "ERROR"],
  TEACH_LESSON_REVIEW: ["TEACH_EDITING", "TEACH_COMPLETE", "HOME", "ERROR"],
  TEACH_EDITING: ["TEACH_LESSON_REVIEW", "TEACH_ANALYZING", "HOME", "ERROR"],
  TEACH_COMPLETE: ["HOME", "LEARN_LIBRARY", "ERROR"],
  LEARN_LIBRARY: ["LEARN_CALIBRATION", "HOME", "ERROR"],
  LEARN_CALIBRATION: ["LEARN_START_POSITION", "HOME", "ERROR"],
  LEARN_START_POSITION: ["LEARN_ACTIVE", "HOME", "ERROR"],
  LEARN_ACTIVE: ["LEARN_SUCCESS", "LEARN_COMPLETE", "HOME", "ERROR"],
  LEARN_SUCCESS: ["LEARN_ACTIVE", "LEARN_COMPLETE", "ERROR"],
  LEARN_COMPLETE: ["HOME", "LEARN_LIBRARY", "ERROR"],
  ERROR: ["HOME"],
};

export function canTransition(from: AppState, to: AppState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function transition(from: AppState, to: AppState): AppState {
  if (!canTransition(from, to)) {
    DebugBus.emit({
      category: "APP",
      level: "warn",
      event: "INVALID_TRANSITION",
      message: `${from} to ${to}`,
    });
    return from;
  }
  DebugBus.emit({
    category: "APP",
    event: "STATE_TRANSITION",
    data: { from, to },
  });
  return to;
}
