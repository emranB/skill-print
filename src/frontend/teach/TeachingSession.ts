import { createId } from "../../shared/utils/id";
import type { TeachingSession } from "./teach.types";

export function createTeachingSession(
  partial?: Partial<Omit<TeachingSession, "schemaVersion" | "id" | "createdAt">>,
): TeachingSession {
  return {
    schemaVersion: 1,
    id: createId(),
    createdAt: new Date().toISOString(),
    ...partial,
  };
}
