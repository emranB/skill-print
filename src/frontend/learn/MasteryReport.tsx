interface Props {
  reps: number;
  sequenceComplete?: boolean;
  kind?: "cycle" | "sequence";
  corrections: number;
  qualityPercent?: number | null;
  predictionResponse: string;
  onDone: () => void;
}

export function MasteryReport({
  reps,
  sequenceComplete,
  kind,
  corrections,
  qualityPercent,
  predictionResponse,
  onDone,
}: Props) {
  return (
    <div className="mastery-report flow-panel">
      <h2>Session complete</h2>
      <dl className="mastery-stats">
        <div>
          <dt>{kind === "sequence" ? "Sequence" : "Completed reps"}</dt>
          <dd>{kind === "sequence" ? (sequenceComplete ? "Complete" : "Incomplete") : reps}</dd>
        </div>
        {qualityPercent != null ? (
          <div>
            <dt>Match quality</dt>
            <dd>{Math.round(qualityPercent)}%</dd>
          </div>
        ) : null}
        <div>
          <dt>Coaching corrections</dt>
          <dd>{corrections}</dd>
        </div>
      </dl>
      <section>
        <h3>Your prediction</h3>
        <p>{predictionResponse || "No prediction given."}</p>
      </section>
      <button type="button" className="primary" onClick={onDone}>
        Done
      </button>
    </div>
  );
}
