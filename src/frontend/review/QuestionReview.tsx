import { useEffect, useMemo, useState } from "react";
import type { CaptureReviewQuestion, QuestionCandidate } from "../analyze/analyze.types";
import { MomentPlayer } from "../media/MomentPlayer";

interface Props {
  questions: CaptureReviewQuestion[];
  videoUrl?: string | null;
  onComplete: (answered: QuestionCandidate[]) => void;
}

export function QuestionReview({ questions, videoUrl, onComplete }: Props) {
  const captureQuestions = useMemo(
    () => questions.filter((q): q is CaptureReviewQuestion => q.phase === "capture_review"),
    [questions],
  );
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.flatMap((q) => (q.answer ? [[q.id, q.answer]] : []))),
  );

  useEffect(() => {
    if (captureQuestions.length === 0) {
      onComplete([]);
    }
  }, [captureQuestions.length, onComplete]);

  const current = captureQuestions[index];
  if (!current) {
    return captureQuestions.length === 0 ? (
      <p className="muted">No capture review questions.</p>
    ) : null;
  }

  const answer = answers[current.id] ?? "";
  const isLast = index >= captureQuestions.length - 1;

  const submit = () => {
    const trimmed = answer.trim();
    if (!trimmed) return;
    const nextAnswers = { ...answers, [current.id]: trimmed };
    setAnswers(nextAnswers);
    if (!isLast) {
      setIndex((i) => i + 1);
      return;
    }
    const answered: QuestionCandidate[] = captureQuestions.map((q) => ({
      ...q,
      answer: nextAnswers[q.id]?.trim(),
      status: nextAnswers[q.id]?.trim() ? "answered" : "skipped",
    }));
    onComplete(answered);
  };

  return (
    <div className="question-review flow-panel">
      <div className="review-progress" aria-hidden="true">
        {captureQuestions.map((q, i) => (
          <span key={q.id} className={i < index ? "done" : i === index ? "current" : ""} />
        ))}
      </div>
      <p className="eyebrow">
        Capture review {index + 1} of {captureQuestions.length}
        {current.askedLive ? (
          <span className="tag live-tag" data-testid="asked-live">
            Asked aloud while you recorded
          </span>
        ) : null}
      </p>
      <h2>{current.question}</h2>
      <MomentPlayer
        src={videoUrl}
        clipStartMs={current.clipStartMs}
        clipEndMs={current.clipEndMs}
        className="moment-clip"
      />
      <label>
        Your answer
        <textarea
          value={answer}
          onChange={(e) => setAnswers((a) => ({ ...a, [current.id]: e.target.value }))}
          rows={4}
          placeholder={current.askedLive ? "Your spoken answer. Edit it if the transcript missed anything" : "Explain what mattered in this moment"}
        />
      </label>
      <button type="button" className="primary" disabled={!answer.trim()} onClick={submit}>
        {isLast ? "Continue to debrief" : "Next question"}
      </button>
    </div>
  );
}
