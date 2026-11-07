import fs from "node:fs";
import { expect, test } from "@playwright/test";
import type { probePoseRepresentation } from "../../src/scripts/level-b/probePoseRepresentation";

test("controlled teacher-only model and CPU extraction probe", async ({ page }) => {
  test.skip(process.env.MOVEMENT_REPRESENTATION_PROBE !== "1", "Explicit diagnostic; not part of learner acceptance");
  await page.goto("/");
  for (const [model, delegate, mode] of [["heavy", "GPU", "IMAGE"], ["heavy", "GPU", "VIDEO"], ["full", "CPU", "VIDEO"]] as const) {
    const result = await page.evaluate(async ({ model, delegate, mode }) => {
      const path="/src/scripts/level-b/probePoseRepresentation.ts";
      const module = await import(path) as { probePoseRepresentation: typeof probePoseRepresentation };
      return module.probePoseRepresentation("/data/lesson-squat.mp4", model, delegate, mode);
    }, { model, delegate, mode });
    fs.writeFileSync(`test-results/movement/final-generic/teacher-${model}-${delegate}-${mode}-seekable.json`, JSON.stringify(result));
    expect(result.frames.length).toBeGreaterThan(900);
    expect(result.frames.at(-1)!.timestampMs).toBeGreaterThan(65_000);
    expect(result.frames.every((f,i)=>i===0 || f.timestampMs>result.frames[i-1]!.timestampMs)).toBe(true);
    console.log(JSON.stringify({ model, delegate, mode, frames: result.frames.length, elapsedMs: result.elapsedMs }));
  }
});
