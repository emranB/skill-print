export type SessionTimeMs = number;

export type DebugCategory =
  | "APP"
  | "CONFIG"
  | "MEDIA"
  | "CALIBRATION"
  | "POSE"
  | "SEGMENTATION"
  | "TRANSCRIPT"
  | "ANALYSIS"
  | "AI"
  | "QUESTION"
  | "LESSON"
  | "STUDENT"
  | "COACH"
  | "STORAGE"
  | "NETWORK"
  | "ERROR"
  | "PERFORMANCE";

export interface DebugEvent {
  id: string;
  wallTimeIso: string;
  sessionTimeMs?: SessionTimeMs;
  category: DebugCategory;
  level: "debug" | "info" | "warn" | "error";
  event: string;
  message?: string;
  data?: unknown;
}

export type DebugListener = (event: DebugEvent) => void;
