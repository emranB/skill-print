export type ApprenticeUiEvent =
  | { type: "message"; role: "apprentice" | "teacher" | "learner"; text: string }
  | { type: "question"; text: string; questionId?: string }
  | { type: "status"; text: string };

export type ApprenticeEventListener = (event: ApprenticeUiEvent) => void;
