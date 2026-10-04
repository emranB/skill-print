import type { DebugEvent } from "./debug.types";

const SECRET_KEY_PATTERN =
  /(api[_-]?key|authorization|cookie|token|secret|password|credential)/i;

export function redactValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (SECRET_KEY_PATTERN.test(value) || value.startsWith("sk_")) {
      return "[REDACTED]";
    }
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(redactValue);
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      out[key] = SECRET_KEY_PATTERN.test(key) ? "[REDACTED]" : redactValue(nested);
    }
    return out;
  }
  return value;
}

export function exportDebugTrace(events: DebugEvent[]): string {
  const redacted = events.map((event) => ({
    ...event,
    data: redactValue(event.data),
    message: typeof event.message === "string" ? String(redactValue(event.message)) : event.message,
  }));
  return JSON.stringify(redacted, null, 2);
}
