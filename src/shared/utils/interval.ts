/**
 * Every evidence window in SkillPrint is half-open: [startMs, endMs).
 * Adjacent windows that share a boundary therefore never share a frame,
 * a transcript word, or an observation.
 */
export function inWindow(timeMs: number, startMs: number, endMs: number): boolean {
  return timeMs >= startMs && timeMs < endMs;
}

export function windowsOverlap(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): boolean {
  return aStartMs < bEndMs && bStartMs < aEndMs;
}

export function overlapMs(
  aStartMs: number,
  aEndMs: number,
  bStartMs: number,
  bEndMs: number,
): number {
  return Math.max(0, Math.min(aEndMs, bEndMs) - Math.max(aStartMs, bStartMs));
}
