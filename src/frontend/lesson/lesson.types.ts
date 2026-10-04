import type { SessionTimeMs } from "../clock/clock.types";
import type {
  CanonicalMovement,
  Demonstration,
  Guardrail,
  KnowledgeItem,
  NormalizedPose,
  TrackingProfile,
  BodyCalibration,
} from "../pose/pose.types";

export interface Lesson {
  schemaVersion: 1;
  id: string;
  name: string;
  importantThings?: string;
  createdAt: string;
  updatedAt: string;
  teacherCalibration: BodyCalibration;
  referencePose: NormalizedPose;
  demonstrations: Demonstration[];
  canonicalMovement: CanonicalMovement;
  knowledge: KnowledgeItem[];
  guardrails: Guardrail[];
  trackingProfile: TrackingProfile;
  sourceSessionId: string;
}

export type { SessionTimeMs };
