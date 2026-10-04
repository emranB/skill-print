import { getDb } from "./IndexedDb";
import type { TeachingSession } from "../teach/teach.types";

export const SessionRepository = {
  async get(id: string): Promise<TeachingSession | undefined> {
    const db = await getDb();
    return (await db.get("sessions", id)) as TeachingSession | undefined;
  },

  async save(session: TeachingSession): Promise<void> {
    const db = await getDb();
    await db.put("sessions", session);
  },

  async delete(id: string): Promise<void> {
    const db = await getDb();
    await db.delete("sessions", id);
  },
};
