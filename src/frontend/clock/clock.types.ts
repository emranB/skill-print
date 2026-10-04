export type SessionTimeMs = number;

export interface SessionClock {
  start(): void;
  now(): SessionTimeMs;
  isRunning(): boolean;
  stop(): void;
  reset(): void;
}
