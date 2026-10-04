import { createId } from "../../shared/utils/id";
import { exportDebugTrace, redactValue } from "../../shared/debug/DebugExporter";
import type { DebugCategory, DebugEvent, DebugListener } from "../../shared/debug/debug.types";

export type EmitInput = {
  category: DebugCategory;
  level?: DebugEvent["level"];
  event: string;
  message?: string;
  data?: unknown;
  sessionTimeMs?: number;
};

/** Oldest events are dropped beyond this so a long live session cannot grow memory without bound. */
const MAX_EVENTS = 5000;

class DebugBusImpl {
  private events: DebugEvent[] = [];
  private listeners = new Set<DebugListener>();
  private enabled = true;

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  emit(input: EmitInput): void {
    if (!this.enabled && input.level !== "error") return;

    const event: DebugEvent = {
      id: createId(),
      wallTimeIso: new Date().toISOString(),
      sessionTimeMs: input.sessionTimeMs,
      category: input.category,
      level: input.level ?? "info",
      event: input.event,
      message: input.message,
      data: input.data === undefined ? undefined : redactValue(input.data),
    };

    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    for (const listener of this.listeners) {
      listener(event);
    }
  }

  subscribe(listener: DebugListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getEvents(): readonly DebugEvent[] {
    return this.events;
  }

  clear(): void {
    this.events = [];
  }

  exportTrace(): string {
    return exportDebugTrace(this.events);
  }
}

export const DebugBus = new DebugBusImpl();
