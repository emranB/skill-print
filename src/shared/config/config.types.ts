export interface RuntimeConfig {
  schemaVersion: 1;
  pose: {
    leniency: number;
    minimumVisibility: number;
    sampleFps: number;
    checkpointHoldMs: number;
  };
  calibration: {
    lostTrackingMs: number;
  };
  review: {
    clipBeforeMs: number;
    clipAfterMs: number;
    maximumQuestions: number;
  };
  coaching: {
    mismatchPersistenceMs: number;
    minimumPromptIntervalMs: number;
  };
  debug: {
    enabled: boolean;
  };
}

export interface RuntimeConfigSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  config: RuntimeConfig;
}
