import type { InterviewView } from "../apprentice/LiveInterview";

/** Overlay on the recording stage showing the apprentice's spoken question and whether it is listening. */
export function LiveInterviewCard({ view }: { view: InterviewView }) {
  const active = view.phase === "asking" || view.phase === "listening";
  return (
    <div className={`interview-card${active ? " active" : ""}`} data-testid="live-interview" data-phase={view.phase}>
      <div className="interview-card-head">
        <span className={`interview-pulse phase-${view.phase}`} aria-hidden="true" />
        <span className="interview-label">
          {view.phase === "asking"
            ? "Apprentice is asking..."
            : view.phase === "listening"
              ? "Listening for your answer"
              : "Apprentice is watching"}
        </span>
        <span className="interview-count">{view.answered} noted</span>
      </div>
      {view.question && view.phase === "listening" ? <p className="interview-question">{view.question}</p> : null}
    </div>
  );
}
