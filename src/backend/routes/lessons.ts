import path from "node:path";
import { Router } from "express";
import { loadEnv } from "../config/env.js";
import { createLessonStore } from "../lessons/lessonStore.js";

export const lessonsRouter = Router();

const store = createLessonStore(path.join(loadEnv().rootDir, "lessons"));

lessonsRouter.get("/lessons", async (_req, res) => {
  const lessons = await store.list();
  res.json({ lessons });
});

lessonsRouter.get("/lessons/:id", async (req, res) => {
  const lesson = await store.read(req.params.id);
  if (!lesson) {
    res.status(404).json({ error: "LESSON_NOT_FOUND" });
    return;
  }
  res.json(lesson);
});

lessonsRouter.put("/lessons/:id", async (req, res) => {
  const body = req.body as { id?: unknown };
  if (!body || body.id !== req.params.id) {
    res.status(400).json({ error: "LESSON_ID_MISMATCH" });
    return;
  }
  const saved = await store.save(req.body);
  if (!saved.ok) {
    res.status(400).json({ error: "LESSON_INVALID" });
    return;
  }
  res.status(204).end();
});

lessonsRouter.delete("/lessons/:id", async (req, res) => {
  await store.remove(req.params.id);
  res.status(204).end();
});
