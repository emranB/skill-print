import { SkeletonCanvas } from "../components/SkeletonCanvas";
import type { Landmark } from "../pose/pose.types";

interface Props {
  teacherLandmarks?: Landmark[] | null;
  studentLandmarks?: Landmark[] | null;
  teacherLabel?: string;
}

export function GhostCoach({ teacherLandmarks, studentLandmarks, teacherLabel = "Teacher" }: Props) {
  return (
    <div className="ghost-coach">
      <div className="ghost-layer" data-testid="ghost-teacher" data-rendered={Boolean(teacherLandmarks?.length)}>
        <span className="ghost-label ghost-teacher">{teacherLabel}</span>
        <SkeletonCanvas landmarks={teacherLandmarks} color="#ffb547" />
      </div>
      <div className="ghost-layer" data-testid="ghost-student" data-rendered={Boolean(studentLandmarks?.length)}>
        <span className="ghost-label ghost-student">You</span>
        <SkeletonCanvas landmarks={studentLandmarks} color="#3dd68c" />
      </div>
    </div>
  );
}
