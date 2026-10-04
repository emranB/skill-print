import { overlapMs } from "../../shared/utils/interval";
import type { Demonstration, PoseFrame } from "../pose/pose.types";
import { summarizeGeometryWindow } from "./GeometrySummarizer";
import type {
  AlignmentStatus,
  AnalysisEvidence,
  GeometryObservation,
  StatementEvidence,
  TeachingStatement,
} from "./analyze.types";

export interface StatementAlignmentOptions {
  lookBeforeMs?: number;
  lookAfterMs?: number;
  minimumVisibility?: number;
}

/** Ranges that count as real movement rather than tracking noise, per measurement kind. */
const SIGNIFICANT_RANGE: Record<GeometryObservation["kind"], number> = {
  angle: 20,
  relative_position: 0.15,
  pair_distance: 0.15,
  excursion: 0.2,
};

function isSignificant(e: AnalysisEvidence): boolean {
  const o = e.data as GeometryObservation | undefined;
  return Boolean(o && Math.abs(o.range) >= SIGNIFICANT_RANGE[o.kind]);
}

function meanReliability(evidence: AnalysisEvidence[]): number {
  if (evidence.length === 0) return 0;
  return (
    evidence.reduce((sum, e) => sum + ((e.data as GeometryObservation | undefined)?.reliability ?? 0), 0) /
    evidence.length
  );
}

/**
 * Link each timestamped statement to the movement around it.
 *
 * The search window covers the speech plus a margin before and after, because
 * teachers often describe a movement just before or just after performing it.
 * ALIGNED: the window overlaps a demonstration and reliable geometry changed.
 * PARTIAL: reliable movement exists but no demonstration overlaps, or overlap is weak.
 * UNALIGNED: verbal-only knowledge. It is kept, never discarded.
 */
export function alignStatements(
  statements: TeachingStatement[],
  frames: PoseFrame[],
  demonstrations: Demonstration[],
  options: StatementAlignmentOptions = {},
): StatementEvidence[] {
  const before = options.lookBeforeMs ?? 1500;
  const after = options.lookAfterMs ?? 1500;
  const lastFrameMs = frames[frames.length - 1]?.timestampMs ?? 0;

  return statements.map((statement) => {
    if (statement.startMs === undefined || statement.endMs === undefined) {
      return {
        statementId: statement.id,
        clipStartMs: 0,
        clipEndMs: 0,
        geometryObservations: [],
        alignment: "UNALIGNED" as AlignmentStatus,
        confidence: statement.confidence * 0.5,
      };
    }
    const clipStartMs = Math.max(0, statement.startMs - before);
    const clipEndMs = Math.min(Math.max(lastFrameMs + 1, statement.endMs), statement.endMs + after);

    const best = demonstrations.reduce<{ demo: Demonstration; overlap: number } | null>((acc, demo) => {
      const overlap = overlapMs(clipStartMs, clipEndMs, demo.startMs, demo.endMs);
      return overlap > 0 && (!acc || overlap > acc.overlap) ? { demo, overlap } : acc;
    }, null);

    const geometry = summarizeGeometryWindow(frames, clipStartMs, clipEndMs, {
      apexMs: best?.demo.apexMs,
      minimumVisibility: options.minimumVisibility,
      maxObservations: 5,
    }).filter((e) => e.feature !== "pose_excursion" || isSignificant(e));
    const significant = geometry.filter(isSignificant);
    const overlapFraction = best ? best.overlap / Math.max(1, clipEndMs - clipStartMs) : 0;

    let alignment: AlignmentStatus = "UNALIGNED";
    if (significant.length > 0 && best && overlapFraction >= 0.25) alignment = "ALIGNED";
    else if (significant.length > 0) alignment = "PARTIAL";

    const reliability = meanReliability(significant);
    const alignmentWeight = alignment === "ALIGNED" ? 1 : alignment === "PARTIAL" ? 0.6 : 0.35;
    const confidence = Math.min(
      1,
      statement.confidence * alignmentWeight * (alignment === "UNALIGNED" ? 1 : 0.5 + 0.5 * reliability),
    );

    return {
      statementId: statement.id,
      clipStartMs,
      clipEndMs,
      demonstrationId: alignment === "UNALIGNED" ? undefined : best?.demo.id,
      geometryObservations: alignment === "UNALIGNED" ? [] : significant,
      alignment,
      confidence,
    };
  });
}
