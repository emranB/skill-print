export type AppState =
  | "HOME"
  | "TEACH_CALIBRATION"
  | "TEACH_SETUP"
  | "TEACH_READY"
  | "TEACH_RECORDING"
  | "TEACH_RECORDING_REVIEW"
  | "TEACH_ANALYZING"
  | "TEACH_QUESTIONS"
  | "TEACH_LESSON_REVIEW"
  | "TEACH_EDITING"
  | "TEACH_COMPLETE"
  | "LEARN_LIBRARY"
  | "LEARN_CALIBRATION"
  | "LEARN_START_POSITION"
  | "LEARN_ACTIVE"
  | "LEARN_SUCCESS"
  | "LEARN_COMPLETE"
  | "ERROR";

export type InputSourceKind = "live" | "upload" | "fixture";
export type ApprenticeMode = "mock" | "elevenlabs";

export interface LessonSummary {
  id: string;
  name: string;
  updatedAt: string;
}
