import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLessonStore } from "../../src/backend/lessons/lessonStore";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function sample(id: string, name: string) {
  return {
    schemaVersion: 1 as const,
    id,
    name,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    teacherCalibration: { scale: 1 },
    referencePose: { timestampMs: 0, landmarks: [] },
    demonstrations: [],
    canonicalMovement: { checkpoints: [] },
    knowledge: [{ id: "k1", statement: "Keep the chest up" }],
    guardrails: [],
    trackingProfile: { requiredLandmarks: [0], requiredFeatures: [] },
    sourceSessionId: "session-1",
  };
}

describe("lesson store", () => {
  it("writes a lesson file and reads it back", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skillprint-lessons-"));
    dirs.push(dir);
    const store = createLessonStore(dir);
    const lesson = sample("lesson-1", "Balance step");

    expect((await store.save(lesson)).ok).toBe(true);
    const raw = await fs.readFile(path.join(dir, "lesson-1.json"), "utf8");
    expect(raw).toContain("Keep the chest up");
    expect(await store.read("lesson-1")).toMatchObject({ name: "Balance step" });
    expect(await store.list()).toHaveLength(1);
  });

  it("rejects a path-like id and a lesson that is missing its name", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "skillprint-lessons-"));
    dirs.push(dir);
    const store = createLessonStore(dir);

    expect((await store.save({ ...sample("ok", "Named"), name: "" })).ok).toBe(false);
    await expect(store.read("../secret")).resolves.toBeUndefined();
    await expect(store.save({ ...sample("ok", "Named"), id: "../secret" })).resolves.toEqual({ ok: false });
    expect(await store.list()).toEqual([]);
  });
});