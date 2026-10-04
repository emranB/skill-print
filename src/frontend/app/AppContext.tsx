import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { z } from "zod";
import type { AppAction } from "./actions";
import { canTransition } from "./AppMachine";
import type { AppState, ApprenticeMode, InputSourceKind, LessonSummary } from "./app.types";
import type { RuntimeConfig } from "../../shared/config/config.types";
import { RuntimeConfigManager } from "../config/RuntimeConfig";
import { DebugBus } from "../debug/DebugBus";

interface AppContextState {
  state: AppState;
  config: RuntimeConfig;
  inputSource: InputSourceKind;
  uploadFile: File | null;
  apprenticeMode: ApprenticeMode;
  /** Server has apprentice credentials; null until the health check answers. */
  apprenticeConfigured: boolean | null;
  /** The user picked a mode explicitly, so the server default no longer applies. */
  apprenticeModeChosen: boolean;
  lessons: LessonSummary[];
  selectedLessonId: string | null;
  statusMessage: string;
  errorMessage?: string;
  /** Last requested transition, reported to the DebugBus after commit so the reducer stays pure. */
  lastTransition?: { from: AppState; to: AppState; accepted: boolean; seq: number };
}

interface AppContextValue extends AppContextState {
  dispatch: (action: AppAction) => void;
  goTo: (next: AppState, errorMessage?: string) => void;
  setConfig: (config: RuntimeConfig) => void;
  refreshLessons: () => Promise<void>;
}

const initialState: AppContextState = {
  state: "HOME",
  config: RuntimeConfigManager.get(),
  inputSource: "live",
  uploadFile: null,
  apprenticeMode: "mock",
  apprenticeConfigured: null,
  apprenticeModeChosen: false,
  lessons: [],
  selectedLessonId: null,
  statusMessage: "Ready",
};

function reducer(state: AppContextState, action: AppAction): AppContextState {
  switch (action.type) {
    case "SET_STATE": {
      const accepted = canTransition(state.state, action.state);
      return {
        ...state,
        state: accepted ? action.state : state.state,
        errorMessage: accepted ? action.errorMessage : state.errorMessage,
        lastTransition: { from: state.state, to: action.state, accepted, seq: (state.lastTransition?.seq ?? 0) + 1 },
      };
    }
    case "SET_CONFIG":
      return { ...state, config: action.config };
    case "SET_INPUT_SOURCE":
      return {
        ...state,
        inputSource: action.source,
        uploadFile: action.source === "upload" ? state.uploadFile : null,
      };
    case "SET_UPLOAD_FILE":
      return { ...state, uploadFile: action.file, inputSource: action.file ? "upload" : state.inputSource };
    case "SET_APPRENTICE_MODE":
      return { ...state, apprenticeMode: action.mode, apprenticeModeChosen: true };
    case "APPRENTICE_STATUS_LOADED":
      return {
        ...state,
        apprenticeConfigured: action.configured,
        apprenticeMode: state.apprenticeModeChosen ? state.apprenticeMode : action.defaultMode,
      };
    case "SET_LESSONS":
      return { ...state, lessons: action.lessons };
    case "SET_SELECTED_LESSON":
      return { ...state, selectedLessonId: action.lessonId };
    case "SET_STATUS_MESSAGE":
      return { ...state, statusMessage: action.message };
    default:
      return state;
  }
}

const AppContext = createContext<AppContextValue | null>(null);

async function loadLessonSummaries(): Promise<LessonSummary[]> {
  try {
    const { LessonRepository } = await import("../storage/LessonRepository");
    const lessons = await LessonRepository.list();
    return lessons.map((lesson) => ({
      id: lesson.id,
      name: lesson.name,
      updatedAt: lesson.updatedAt,
    }));
  } catch {
    return [];
  }
}

const HealthSchema = z.object({
  apprentice: z.object({ configured: z.boolean(), defaultMode: z.enum(["mock", "elevenlabs"]) }),
});

async function loadApprenticeStatus(): Promise<z.infer<typeof HealthSchema>["apprentice"]> {
  try {
    const response = await fetch("/api/health");
    return HealthSchema.parse(await response.json()).apprentice;
  } catch {
    return { configured: false, defaultMode: "mock" };
  }
}

let applicationStarted = false;

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const t = state.lastTransition;
    if (!t) return;
    if (t.accepted) {
      DebugBus.emit({ category: "APP", event: "STATE_TRANSITION", data: { from: t.from, to: t.to } });
    } else {
      DebugBus.emit({ category: "APP", level: "warn", event: "INVALID_TRANSITION", message: `${t.from} to ${t.to}` });
    }
  }, [state.lastTransition]);

  const goTo = useCallback((next: AppState, errorMessage?: string) => {
    dispatch({ type: "SET_STATE", state: next, errorMessage });
  }, []);

  const setConfig = useCallback((config: RuntimeConfig) => {
    dispatch({ type: "SET_CONFIG", config });
  }, []);

  const refreshLessons = useCallback(async () => {
    const lessons = await loadLessonSummaries();
    dispatch({ type: "SET_LESSONS", lessons });
    DebugBus.emit({
      category: "STORAGE",
      event: "STORAGE_READY",
      data: { lessonCount: lessons.length },
    });
  }, []);

  useEffect(() => {
    if (!applicationStarted) {
      applicationStarted = true;
      DebugBus.emit({ category: "APP", event: "APPLICATION_STARTED" });
    }
    void loadApprenticeStatus().then((status) => {
      dispatch({ type: "APPRENTICE_STATUS_LOADED", ...status });
      DebugBus.emit({ category: "AI", event: "APPRENTICE_STATUS", data: status });
    });
    void (async () => {
      const config = await RuntimeConfigManager.load();
      dispatch({ type: "SET_CONFIG", config });
      await refreshLessons();
    })();
  }, [refreshLessons]);

  const value = useMemo(
    () => ({
      ...state,
      dispatch,
      goTo,
      setConfig,
      refreshLessons,
    }),
    [state, goTo, setConfig, refreshLessons],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("useApp must be used within AppProvider");
  return ctx;
}
