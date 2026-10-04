import { useEffect, useState } from "react";
import { useApp } from "../app/AppContext";
import { useApprentice } from "../apprentice/ApprenticeProvider";
import type {
  CaptureReviewQuestion,
  DebriefQuestion,
  QuestionCandidate,
} from "../analyze/analyze.types";
import { extractAnswerStatements } from "../analyze/TeachingEnrichment";
import { liveEntriesToQuestions } from "../apprentice/LiveInterview";
import { buildTeachBackItems } from "../lesson/TeachBackItems";
import { useTeachPipeline } from "../teach/TeachPipelineContext";
import { QuestionReview } from "./QuestionReview";
import { Debrief } from "./Debrief";
import { LessonReview } from "./LessonReview";
import { useObjectUrl } from "../media/useObjectUrl";
import { TeachBackReview } from "./TeachBackReview";

type ReviewPhase = "loading" | "capture" | "debrief" | "teachback" | "lesson";

export function ReviewFlow() {
  const { state, config, goTo } = useApp();
  const apprentice = useApprentice();
  const {
    session,
    analysis,
    questions,
    setQuestions,
    debriefQuestions,
    setDebriefQuestions,
    teachBackText,
    setTeachBackText,
    teachBackItems,
    setTeachBackItems,
    setTeachBackConfirmed,
    setDraftLesson,
  } = useTeachPipeline();

  const [phase, setPhase] = useState<ReviewPhase>("loading");
  const [captureAnswered, setCaptureAnswered] = useState<QuestionCandidate[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const videoUrl = useObjectUrl(session.media?.video);

  useEffect(() => {
    if (state !== "TEACH_QUESTIONS" || !analysis) return;
    if (questions.length > 0) {
      setPhase("capture");
      return;
    }
    let cancelled = false;
    const live = liveEntriesToQuestions(session.liveInterview?.entries ?? []);
    void (async () => {
      try {
        const generated = await apprentice.generateCaptureReviewQuestions({
          analysis,
          maxQuestions: Math.max(2, config.review.maximumQuestions - live.length),
          skillName: session.lessonName,
        });
        if (cancelled) return;
        setQuestions([...live, ...generated]);
        setPhase("capture");
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load questions");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    analysis,
    apprentice,
    config.review.maximumQuestions,
    questions.length,
    session.lessonName,
    session.liveInterview?.entries,
    setQuestions,
    state,
  ]);

  useEffect(() => {
    if (state === "TEACH_LESSON_REVIEW") setPhase("lesson");
  }, [state]);

  if (!analysis && state !== "TEACH_LESSON_REVIEW") {
    return <p className="muted">Waiting for analysis...</p>;
  }
  if (error) return <p className="error-text">{error}</p>;
  if (busy) return <p className="muted">{busy}</p>;

  if (state === "TEACH_LESSON_REVIEW" && analysis) {
    return (
      <LessonReview
        session={session}
        analysis={analysis}
        questions={questions}
        teachBackItems={teachBackItems}
        onSubmitted={() => setDraftLesson(null)}
      />
    );
  }

  if (phase === "loading") return <p className="muted">Preparing capture review...</p>;

  if (phase === "capture") {
    return (
      <QuestionReview
        questions={questions as CaptureReviewQuestion[]}
        videoUrl={videoUrl}
        onComplete={(answered) => {
          setCaptureAnswered(answered);
          setQuestions(answered);
          setBusy("Apprentice is preparing follow-up questions...");
          void (async () => {
            try {
              const debrief = await apprentice.generateDebriefQuestions({
                answered,
                analysis: analysis!,
                skillName: session.lessonName,
              });
              setDebriefQuestions(debrief);
              setPhase("debrief");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Debrief failed");
            } finally {
              setBusy(null);
            }
          })();
        }}
      />
    );
  }

  if (phase === "debrief") {
    return (
      <Debrief
        questions={debriefQuestions.filter((q): q is DebriefQuestion => q.phase === "debrief")}
        onComplete={(debriefAnswered) => {
          setDebriefQuestions(debriefAnswered);
          const all = [...captureAnswered, ...debriefAnswered];
          setQuestions(all);
          setBusy("Apprentice is preparing its teach-back...");
          void (async () => {
            try {
              const answerStatements = await extractAnswerStatements(all, apprentice);
              const items = buildTeachBackItems(
                analysis!.statements ?? [],
                analysis!.statementEvidence ?? [],
                answerStatements,
                all,
              );
              setTeachBackItems(items);
              setTeachBackText(await apprentice.generateTeachBack({ items, skillName: session.lessonName }));
              setPhase("teachback");
            } catch (e) {
              setError(e instanceof Error ? e.message : "Teach-back failed");
            } finally {
              setBusy(null);
            }
          })();
        }}
      />
    );
  }

  if (phase === "teachback") {
    return (
      <TeachBackReview
        summary={teachBackText}
        items={teachBackItems}
        onChange={setTeachBackItems}
        onConfirm={() => {
          setTeachBackConfirmed(true);
          goTo("TEACH_LESSON_REVIEW");
          setPhase("lesson");
        }}
      />
    );
  }

  return null;
}
