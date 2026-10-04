import { useApp } from "../app/AppContext";
import type { AppState } from "../app/app.types";
import { StatusBadge } from "./StatusBadge";
import { ConfigPanel } from "../config/ConfigPanel";
import { ApprenticeVoice } from "../apprentice/ApprenticeVoice";
import { CaptureSourceControls } from "../media/CaptureSourceControls";
import { canTransition } from "../app/AppMachine";

const STATE_COPY: Record<AppState, string> = {
  HOME: "Ready. Teach me a skill by doing, or pick a saved lesson to learn.",
  TEACH_CALIBRATION: "Checking the camera, the microphone, and that your whole body is in frame.",
  TEACH_SETUP: "Name the skill. Anything you mark as important becomes a guardrail.",
  TEACH_READY: "Frame yourself, then start the demonstration.",
  TEACH_RECORDING: "Recording. Keep your whole body in view.",
  TEACH_RECORDING_REVIEW: "Mark each repetition, then analyze the demonstration.",
  TEACH_ANALYZING: "Reading speech and movement from the demonstration.",
  TEACH_QUESTIONS: "Answer what the apprentice still needs to know.",
  TEACH_LESSON_REVIEW: "Confirm the lesson before it is saved.",
  TEACH_EDITING: "Edit this saved lesson.",
  TEACH_COMPLETE: "Lesson saved. You can teach another, or learn this one.",
  LEARN_LIBRARY: "Pick a lesson to practice.",
  LEARN_CALIBRATION: "Step into frame so the coach can see your whole body.",
  LEARN_START_POSITION: "Answer the prediction, then line up with the teacher.",
  LEARN_ACTIVE: "Orange is the teacher ghost. Green is you.",
  LEARN_SUCCESS: "That repetition matched.",
  LEARN_COMPLETE: "Session complete.",
  ERROR: "Something went wrong. Exit home and try again.",
};

export function ApprenticePanel() {
  const { state, statusMessage, apprenticeMode, apprenticeConfigured, dispatch, errorMessage, goTo } = useApp();

  return (
    <aside className="apprentice-panel">
      <header className="side-head">
        <div>
          <p className="side-kicker">Session</p>
          <p className="side-lead">{STATE_COPY[state]}</p>
        </div>
        <StatusBadge label={statusMessage} tone={state === "ERROR" ? "error" : "ok"} />
      </header>

      <div className="apprentice-body">
        {errorMessage ? <p className="error-text">{errorMessage}</p> : null}
        {state !== "HOME" && canTransition(state, "HOME") ? (
          <button type="button" className="text-button" data-testid="exit-home" onClick={() => goTo("HOME")}>
            Exit to Home
          </button>
        ) : null}

        <CaptureSourceControls />

        <section className="side-card">
          <div className="side-card-head">
            <p className="side-kicker">Apprentice</p>
            <p className="apprentice-mode" data-testid="apprentice-mode" data-mode={apprenticeMode}>
              {apprenticeMode === "elevenlabs" ? "Online" : apprenticeConfigured === false ? "No key" : "Offline"}
            </p>
          </div>
          <label className="side-field">
            <span className="visually-hidden">Apprentice</span>
            <select
              value={apprenticeMode}
              onChange={(e) =>
                dispatch({
                  type: "SET_APPRENTICE_MODE",
                  mode: e.target.value as "mock" | "elevenlabs",
                })
              }
            >
              <option value="elevenlabs">ElevenLabs</option>
              <option value="mock">Mock</option>
            </select>
          </label>
          {apprenticeMode === "elevenlabs" ? <ApprenticeVoice /> : null}
        </section>

        <ConfigPanel />
      </div>
    </aside>
  );
}
