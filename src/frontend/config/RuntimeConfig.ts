import { DebugBus } from "../debug/DebugBus";
import type { RuntimeConfig, RuntimeConfigSnapshot } from "../../shared/config/config.types";

const DEFAULT_CONFIG: RuntimeConfig = {
  schemaVersion: 1,
  pose: {
    leniency: 0.25,
    minimumVisibility: 0.65,
    sampleFps: 15,
    checkpointHoldMs: 150,
  },
  calibration: {
    lostTrackingMs: 1000,
  },
  review: {
    clipBeforeMs: 1500,
    clipAfterMs: 1500,
    maximumQuestions: 6,
  },
  coaching: {
    mismatchPersistenceMs: 500,
    minimumPromptIntervalMs: 2500,
  },
  debug: {
    enabled: true,
  },
};

function deepMerge<T extends object>(base: T, patch: Partial<T>): T {
  const out = { ...base };
  for (const key of Object.keys(patch) as Array<keyof T>) {
    const value = patch[key];
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof base[key] === "object" &&
      base[key] !== null
    ) {
      out[key] = deepMerge(base[key] as object, value as object) as T[keyof T];
    } else if (value !== undefined) {
      out[key] = value as T[keyof T];
    }
  }
  return out;
}

class RuntimeConfigManagerImpl {
  private fileConfig: RuntimeConfig = DEFAULT_CONFIG;
  private overrides: Partial<RuntimeConfig> = {};
  private loaded = false;

  async load(): Promise<RuntimeConfig> {
    try {
      const response = await fetch("/api/config");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const json = (await response.json()) as RuntimeConfig;
      this.fileConfig = deepMerge(DEFAULT_CONFIG, json);
      this.loaded = true;
      DebugBus.emit({
        category: "CONFIG",
        event: "CONFIG_LOADED",
        data: this.fileConfig,
      });
    } catch (error) {
      this.fileConfig = DEFAULT_CONFIG;
      this.loaded = true;
      DebugBus.emit({
        category: "CONFIG",
        level: "warn",
        event: "CONFIG_LOAD_FALLBACK",
        message: error instanceof Error ? error.message : "Unknown error",
        data: this.fileConfig,
      });
    }
    DebugBus.setEnabled(this.get().debug.enabled);
    return this.get();
  }

  get(): RuntimeConfig {
    return deepMerge(this.fileConfig, this.overrides);
  }

  update(patch: Partial<RuntimeConfig>): RuntimeConfig {
    this.overrides = deepMerge(this.overrides, patch);
    const next = this.get();
    DebugBus.setEnabled(next.debug.enabled);
    DebugBus.emit({
      category: "CONFIG",
      event: "CONFIG_CHANGED",
      data: { overrides: this.overrides, effective: next },
    });
    return next;
  }

  resetOverrides(): RuntimeConfig {
    this.overrides = {};
    const next = this.get();
    DebugBus.setEnabled(next.debug.enabled);
    DebugBus.emit({
      category: "CONFIG",
      event: "CONFIG_RESET",
      data: next,
    });
    return next;
  }

  snapshot(): RuntimeConfigSnapshot {
    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      config: this.get(),
    };
  }

  isLoaded(): boolean {
    return this.loaded;
  }
}

export const RuntimeConfigManager = new RuntimeConfigManagerImpl();
