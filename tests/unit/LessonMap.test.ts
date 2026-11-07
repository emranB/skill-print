import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { LessonMap } from "../../src/frontend/lesson/LessonMap";
import type { Lesson } from "../../src/frontend/lesson/lesson.types";

describe("Work Map movement wording", () => {
  it.each(["cycle", "sequence"] as const)(
    "shows %s without rewriting stored generic phases",
    (kind) => {
      const lesson = {
        name: "Movement",
        canonicalMovement: { kind, checkpoints: [{ index: 0, progress: 0, phase: "sequence" }] },
        knowledge: [],
        guardrails: [],
        demonstrations: [{ id: "example", startMs: 0, endMs: 1000, classification: "good" }],
      } as unknown as Lesson;
      const original = JSON.stringify(lesson);
      const html = renderToStaticMarkup(createElement(LessonMap, { lesson }));
      expect(html).toContain(`0%, ${kind}`);
      expect(JSON.stringify(lesson)).toBe(original);
      if (kind === "cycle") expect(html).not.toContain("sequence");
      if (kind === "sequence") {
        expect(html).toContain("Sequence 1:");
        expect(html).not.toContain("Repetition");
      }
    },
  );
});
