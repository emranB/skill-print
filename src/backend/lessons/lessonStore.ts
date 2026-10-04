import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

/** Safe file name. Lesson ids are UUIDs or the same character set. */
const LESSON_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Shape written to disk. Nested teaching data is kept intact.
 * The browser validates the full lesson again before it enters app state.
 */
const StoredLessonSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().regex(LESSON_ID),
    name: z.string().min(1),
    importantThings: z.string().optional(),
    createdAt: z.string(),
    updatedAt: z.string(),
    teacherCalibration: z.unknown(),
    referencePose: z.unknown(),
    demonstrations: z.array(z.unknown()),
    canonicalMovement: z.unknown(),
    knowledge: z.array(z.unknown()),
    guardrails: z.array(z.unknown()),
    trackingProfile: z.unknown(),
    sourceSessionId: z.string(),
  })
  .passthrough();

export type StoredLesson = z.infer<typeof StoredLessonSchema>;

export interface LessonStore {
  list(): Promise<StoredLesson[]>;
  read(id: string): Promise<StoredLesson | undefined>;
  save(lesson: unknown): Promise<{ ok: true } | { ok: false }>;
  remove(id: string): Promise<void>;
}

/** One JSON file per lesson: lessons/<id>.json */
export function createLessonStore(directory: string): LessonStore {
  const fileFor = (id: string): string => {
    if (!LESSON_ID.test(id)) throw new Error("Invalid lesson id");
    return path.join(directory, `${id}.json`);
  };

  const readFile = async (filePath: string): Promise<StoredLesson | undefined> => {
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(filePath, "utf8"));
      const result = StoredLessonSchema.safeParse(parsed);
      return result.success ? result.data : undefined;
    } catch {
      return undefined;
    }
  };

  return {
    async list() {
      await fs.mkdir(directory, { recursive: true });
      const names = await fs.readdir(directory);
      const lessons: StoredLesson[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const lesson = await readFile(path.join(directory, name));
        if (lesson) lessons.push(lesson);
      }
      return lessons.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async read(id: string) {
      if (!LESSON_ID.test(id)) return undefined;
      return readFile(fileFor(id));
    },

    async save(lesson: unknown) {
      const result = StoredLessonSchema.safeParse(lesson);
      if (!result.success) return { ok: false };
      await fs.mkdir(directory, { recursive: true });
      const file = fileFor(result.data.id);
      const temp = `${file}.${process.pid}.tmp`;
      await fs.writeFile(temp, `${JSON.stringify(result.data, null, 2)}\n`, "utf8");
      await fs.rename(temp, file);
      return { ok: true };
    },

    async remove(id: string) {
      if (!LESSON_ID.test(id)) return;
      await fs.rm(fileFor(id), { force: true });
    },
  };
}
