import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "skillprint";
const DB_VERSION = 1;

export type SkillPrintDb = IDBPDatabase<{
  lessons: {
    key: string;
    value: unknown;
    indexes: { updatedAt: string };
  };
  sessions: {
    key: string;
    value: unknown;
  };
}>;

let dbPromise: Promise<SkillPrintDb> | null = null;

export function getDb(): Promise<SkillPrintDb> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("lessons")) {
          const lessons = db.createObjectStore("lessons", { keyPath: "id" });
          lessons.createIndex("updatedAt", "updatedAt");
        }
        if (!db.objectStoreNames.contains("sessions")) {
          db.createObjectStore("sessions", { keyPath: "id" });
        }
      },
    }) as Promise<SkillPrintDb>;
  }
  return dbPromise;
}
