import {
  createContext,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import type { SessionAnalysis } from "../analyze/analyze.types";
import type { QuestionCandidate } from "../analyze/analyze.types";
import type { Demonstration } from "../pose/pose.types";
import type { Lesson } from "../lesson/lesson.types";
import type { TeachBackItem } from "../lesson/TeachBackItems";
import { createTeachingSession } from "./TeachingSession";
import type { TeachingSession } from "./teach.types";

interface TeachPipelineValue {
  session: TeachingSession;
  setSession: Dispatch<SetStateAction<TeachingSession>>;
  pendingDemonstrations: Demonstration[];
  setPendingDemonstrations: Dispatch<SetStateAction<Demonstration[]>>;
  analysis: SessionAnalysis | null;
  setAnalysis: Dispatch<SetStateAction<SessionAnalysis | null>>;
  questions: QuestionCandidate[];
  setQuestions: Dispatch<SetStateAction<QuestionCandidate[]>>;
  debriefQuestions: QuestionCandidate[];
  setDebriefQuestions: Dispatch<SetStateAction<QuestionCandidate[]>>;
  teachBackText: string;
  setTeachBackText: Dispatch<SetStateAction<string>>;
  teachBackConfirmed: boolean;
  setTeachBackConfirmed: Dispatch<SetStateAction<boolean>>;
  teachBackItems: TeachBackItem[];
  setTeachBackItems: Dispatch<SetStateAction<TeachBackItem[]>>;
  draftLesson: Lesson | null;
  setDraftLesson: Dispatch<SetStateAction<Lesson | null>>;
  predictionAnswer: string;
  setPredictionAnswer: Dispatch<SetStateAction<string>>;
}

const TeachPipelineContext = createContext<TeachPipelineValue | null>(null);

export function TeachPipelineProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState(() => createTeachingSession());
  const [pendingDemonstrations, setPendingDemonstrations] = useState<Demonstration[]>([]);
  const [analysis, setAnalysis] = useState<SessionAnalysis | null>(null);
  const [questions, setQuestions] = useState<QuestionCandidate[]>([]);
  const [debriefQuestions, setDebriefQuestions] = useState<QuestionCandidate[]>([]);
  const [teachBackText, setTeachBackText] = useState("");
  const [teachBackConfirmed, setTeachBackConfirmed] = useState(false);
  const [teachBackItems, setTeachBackItems] = useState<TeachBackItem[]>([]);
  const [draftLesson, setDraftLesson] = useState<Lesson | null>(null);
  const [predictionAnswer, setPredictionAnswer] = useState("");

  const value = useMemo(
    () => ({
      session,
      setSession,
      pendingDemonstrations,
      setPendingDemonstrations,
      analysis,
      setAnalysis,
      questions,
      setQuestions,
      debriefQuestions,
      setDebriefQuestions,
      teachBackText,
      setTeachBackText,
      teachBackConfirmed,
      setTeachBackConfirmed,
      teachBackItems,
      setTeachBackItems,
      draftLesson,
      setDraftLesson,
      predictionAnswer,
      setPredictionAnswer,
    }),
    [
      session,
      pendingDemonstrations,
      analysis,
      questions,
      debriefQuestions,
      teachBackText,
      teachBackConfirmed,
      teachBackItems,
      draftLesson,
      predictionAnswer,
    ],
  );

  return <TeachPipelineContext.Provider value={value}>{children}</TeachPipelineContext.Provider>;
}

export function useTeachPipeline(): TeachPipelineValue {
  const ctx = useContext(TeachPipelineContext);
  if (!ctx) throw new Error("useTeachPipeline requires TeachPipelineProvider");
  return ctx;
}
