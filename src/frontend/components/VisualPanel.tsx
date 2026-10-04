import { useEffect } from "react";
import { useApp } from "../app/AppContext";
import { cameraManager } from "../media/CameraManager";
import type { AppState } from "../app/app.types";
import { LearnFlow } from "../learn/LearnFlow";
import { LessonEditor } from "../review/LessonEditor";
import { ReviewFlow } from "../review/ReviewFlow";
import { TeachFlow } from "../teach/TeachFlow";
import { TeachPipelineProvider } from "../teach/TeachPipelineContext";
import { LandingPage } from "./LandingPage";

/** States that show or record the camera. Leaving them releases every capture track. */
const CAMERA_STATES: ReadonlySet<AppState> = new Set<AppState>([
  "TEACH_CALIBRATION",
  "TEACH_SETUP",
  "TEACH_READY",
  "TEACH_RECORDING",
  "LEARN_CALIBRATION",
  "LEARN_START_POSITION",
  "LEARN_ACTIVE",
]);

function isTeachState(state: AppState): boolean {
  return state.startsWith("TEACH_");
}

function isLearnState(state: AppState): boolean {
  return state.startsWith("LEARN_");
}

function TeachStage() {
  const { state } = useApp();

  if (state === "TEACH_EDITING") {
    return <LessonEditor />;
  }
  if (state === "TEACH_QUESTIONS" || state === "TEACH_LESSON_REVIEW") {
    return <ReviewFlow />;
  }
  return <TeachFlow />;
}

export function VisualPanel() {
  const { state, goTo } = useApp();

  useEffect(() => {
    if (!CAMERA_STATES.has(state) && !cameraManager.isKeepOpen()) cameraManager.releaseAll();
  }, [state]);

  if (state === "HOME") {
    return (
      <div className="visual-panel home-panel">
        <LandingPage />
      </div>
    );
  }

  if (isLearnState(state)) {
    return (
      <div className="visual-panel stage-panel">
        <LearnFlow />
      </div>
    );
  }

  if (isTeachState(state)) {
    return (
      <div className="visual-panel stage-panel">
        <TeachPipelineProvider>
          <TeachStage />
        </TeachPipelineProvider>
      </div>
    );
  }

  return (
    <div className="visual-panel stage-panel">
      <p className="muted">State: {state}</p>
      <button type="button" onClick={() => goTo("HOME")}>
        Back home
      </button>
    </div>
  );
}
