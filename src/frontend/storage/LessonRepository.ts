import { getDb } from "./IndexedDb";
import type { Lesson } from "../lesson/lesson.types";
import { LessonSchema } from "../lesson/LessonSchema";
import { DebugBus } from "../debug/DebugBus";
import { z } from "zod";
import type { LessonSummary } from "../app/app.types";

const SummarySchema = z.object({ id: z.string(), name: z.string().min(1), updatedAt: z.string() });
const remoteVersions = new Map<string, string>();

/** Stored records are validated on read; damaged ones are reported and never returned. */
function validLesson(record: unknown): Lesson | undefined {
  const result = LessonSchema.safeParse(record);
  if (result.success) return record as Lesson;
  const id = typeof record === "object" && record && "id" in record ? String(record.id) : "unknown";
  DebugBus.emit({
    category: "STORAGE",
    level: "warn",
    event: "LESSON_INVALID",
    message: `Stored lesson ${id} failed validation`,
    data: {
      id,
      issues: result.error.issues.slice(0, 3).map((i) => `${i.path.join(".")}: ${i.message}`),
    },
  });
  return undefined;
}

async function pullRemoteLessons(): Promise<void> {
  try {
    const response = await fetch("/api/lessons");
    if (!response.ok) return;
    const body = (await response.json()) as { lessons?: unknown[] };
    const db = await getDb();
    for (const record of body.lessons ?? []) {
      const lesson = validLesson(record);
      if (lesson) await db.put("lessons", lesson);
    }
  } catch {
    DebugBus.emit({ category: "STORAGE", level: "warn", event: "LESSON_SYNC_FAILED" });
  }
}

async function pushRemoteLesson(lesson: Lesson): Promise<void> {
  try {
    const response = await fetch(`/api/lessons/${encodeURIComponent(lesson.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lesson),
    });
    if (!response.ok) {
      DebugBus.emit({
        category: "STORAGE",
        level: "warn",
        event: "LESSON_SAVE_REMOTE_FAILED",
        data: { id: lesson.id, status: response.status },
      });
      return;
    }
    DebugBus.emit({
      category: "STORAGE",
      event: "LESSON_SAVED",
      data: { id: lesson.id, name: lesson.name },
    });
  } catch {
    DebugBus.emit({
      category: "STORAGE",
      level: "warn",
      event: "LESSON_SAVE_REMOTE_FAILED",
      data: { id: lesson.id },
    });
  }
}

export const LessonRepository = {
  async listSummaries(): Promise<LessonSummary[]> {
    const summaries = new Map<string, LessonSummary>();
    const db = await getDb();
    // Stream existing local lessons one at a time; never clone all pose histories together.
    let cursor = await db.transaction("lessons").store.openCursor();
    while (cursor) {
      const lesson = validLesson(cursor.value);
      if (lesson)
        summaries.set(lesson.id, { id: lesson.id, name: lesson.name, updatedAt: lesson.updatedAt });
      cursor = await cursor.continue();
    }
    try {
      const response = await fetch("/api/lessons?summary=1");
      if (response.ok) {
        const body = z.object({ lessons: z.array(SummarySchema) }).parse(await response.json());
        for (const summary of body.lessons) {
          remoteVersions.set(summary.id, summary.updatedAt);
          const local = summaries.get(summary.id);
          if (!local || summary.updatedAt >= local.updatedAt) summaries.set(summary.id, summary);
        }
      }
    } catch {
      DebugBus.emit({ category: "STORAGE", level: "warn", event: "LESSON_SYNC_FAILED" });
    }
    return [...summaries.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async list(): Promise<Lesson[]> {
    await pullRemoteLessons();
    const db = await getDb();
    const lessons = (await db.getAll("lessons"))
      .map(validLesson)
      .filter((lesson): lesson is Lesson => lesson !== undefined);
    return lessons.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async get(id: string): Promise<Lesson | undefined> {
    const db = await getDb();
    let record: unknown = await db.get("lessons", id);
    const local = record === undefined ? undefined : validLesson(record);
    const remoteVersion = remoteVersions.get(id);
    if (record === undefined || (remoteVersion && remoteVersion > (local?.updatedAt ?? ""))) {
      try {
        const response = await fetch(`/api/lessons/${encodeURIComponent(id)}`);
        if (response.ok) {
          const lesson = validLesson(await response.json());
          if (lesson) {
            await db.put("lessons", lesson);
            record = lesson;
          }
        }
      } catch {
        DebugBus.emit({
          category: "STORAGE",
          level: "warn",
          event: "LESSON_SYNC_FAILED",
          data: { id },
        });
      }
    }
    return record === undefined ? undefined : validLesson(record);
  },

  async save(lesson: Lesson): Promise<void> {
    const db = await getDb();
    await db.put("lessons", lesson);
    await pushRemoteLesson(lesson);
  },

  async delete(id: string): Promise<void> {
    const db = await getDb();
    await db.delete("lessons", id);
    try {
      await fetch(`/api/lessons/${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch {
      DebugBus.emit({
        category: "STORAGE",
        level: "warn",
        event: "LESSON_SYNC_FAILED",
        data: { id },
      });
    }
  },
};
