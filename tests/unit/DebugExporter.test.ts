import { describe, expect, it } from "vitest";
import { exportDebugTrace, redactValue } from "../../src/shared/debug/DebugExporter";

describe("DebugExporter", () => {
  it("redacts secret-looking keys and sk_ values", () => {
    expect(redactValue({ apiKey: "sk_test", nested: { authorization: "Bearer x" } })).toEqual({
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]" },
    });
    expect(redactValue("sk_abc")).toBe("[REDACTED]");
  });

  it("exports a JSON trace", () => {
    const text = exportDebugTrace([
      {
        id: "1",
        wallTimeIso: "2026-01-01T00:00:00.000Z",
        category: "APP",
        level: "info",
        event: "TEST",
        data: { token: "secret" },
      },
    ]);
    expect(text).toContain("TEST");
    expect(text).toContain("[REDACTED]");
    expect(text).not.toContain("secret");
  });
});
