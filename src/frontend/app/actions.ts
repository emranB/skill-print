import type { AppState, ApprenticeMode, InputSourceKind, LessonSummary } from "./app.types";
import type { RuntimeConfig } from "../../shared/config/config.types";

export type AppAction =
  | { type: "SET_STATE"; state: AppState; errorMessage?: string }
  | { type: "SET_CONFIG"; config: RuntimeConfig }
  | { type: "SET_INPUT_SOURCE"; source: InputSourceKind }
  | { type: "SET_UPLOAD_FILE"; file: File | null }
  | { type: "SET_APPRENTICE_MODE"; mode: ApprenticeMode }
  | { type: "APPRENTICE_STATUS_LOADED"; configured: boolean; defaultMode: ApprenticeMode }
  | { type: "SET_LESSONS"; lessons: LessonSummary[] }
  | { type: "SET_SELECTED_LESSON"; lessonId: string | null }
  | { type: "SET_STATUS_MESSAGE"; message: string };
