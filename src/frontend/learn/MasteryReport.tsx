interface Props {
  reps: number;
  corrections: number;
  predictionResponse: string;
  onDone: () => void;
}

export function MasteryReport({ reps, corrections, predictionResponse, onDone }: Props) {
  return (
    <div className="mastery-report flow-panel">
      <h2>Session complete</h2>
      <dl className="mastery-stats">
        <div>
          <dt>Successful reps</dt>
          <dd>{reps}</dd>
        </div>
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
