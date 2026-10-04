import { useState } from "react";
import type { DebriefQuestion, QuestionCandidate } from "../analyze/analyze.types";

interface Props {
  questions: DebriefQuestion[];
  onComplete: (answered: QuestionCandidate[]) => void;
}

export function Debrief({ questions, onComplete }: Props) {
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const current = questions[index];

  const finish = (latest: Record<string, string>) =>
    onComplete(
      questions.map((q) => ({
        ...q,
        answer: latest[q.id]?.trim() || undefined,
        status: latest[q.id]?.trim() ? "answered" : "skipped",
      })),
    );

  if (!current) {
    return (
      <div className="debrief flow-panel">
        <p className="muted">No follow-up questions.</p>
        <button type="button" className="primary" onClick={() => finish(answers)}>
          Continue to teach-back
        </button>
      </div>
    );
  }

  const answer = answers[current.id] ?? "";
  const isLast = index >= questions.length - 1;
  const advance = (latest: Record<string, string>) => {
    if (isLast) finish(latest);
    else setIndex((i) => i + 1);
  };

  return (
    <div className="debrief flow-panel">
      <p className="eyebrow">
        Debrief {index + 1} of {questions.length}
      </p>
      <h2>{current.question}</h2>
      <label>
        Your answer
        <textarea
          value={answer}
          onChange={(e) => setAnswers((a) => ({ ...a, [current.id]: e.target.value }))}
          rows={4}
        />
      </label>
      <div className="home-actions">
        <button type="button" className="secondary" onClick={() => advance({ ...answers, [current.id]: "" })}>
          Skip
        </button>
        <button type="button" className="primary" disabled={!answer.trim()} onClick={() => advance(answers)}>
          {isLast ? "Teach-back" : "Next"}
        </button>
      </div>
    </div>
  );
}
