import { inWindow } from "../../shared/utils/interval";
import type { AnalysisEvidence, TeachingUnit, Transcript, TranscriptWord } from "./analyze.types";

/** Words whose midpoint falls in [startMs, endMs). Each word belongs to exactly one adjacent window. */
export function alignTranscriptToWindow(
  transcript: Transcript | undefined,
  startMs: number,
  endMs: number,
): TranscriptWord[] {
  if (!transcript) return [];
  return transcript.words.filter((w) => inWindow((w.startMs + w.endMs) / 2, startMs, endMs));
}

export function buildTimelineNotes(
  transcript: Transcript | undefined,
  windows: Array<{ startMs: number; endMs: number; label: string }>,
): AnalysisEvidence[] {
  if (!transcript) return [];
  return windows.map((window) => {
    const words = alignTranscriptToWindow(transcript, window.startMs, window.endMs);
    return {
      feature: "transcript_alignment",
      description: window.label,
      startMs: window.startMs,
      endMs: window.endMs,
      data: {
        text: words.map((w) => w.text).join(" "),
        wordCount: words.length,
      },
    };
  });
}

const SENTENCE_END = /[.!?]["')\]]*$/;

/**
 * Split timestamped words into sentence units using the recognizer's own
 * punctuation. Very long runs without punctuation are cut at long pauses so a
 * single unit never spans a whole monologue.
 */
export function transcriptToUnits(
  transcript: Transcript | undefined,
  options: { maxUnitMs?: number; pauseMs?: number } = {},
): TeachingUnit[] {
  if (!transcript || transcript.words.length === 0) return [];
  const maxUnitMs = options.maxUnitMs ?? 16_000;
  const pauseMs = options.pauseMs ?? 700;
  const units: TeachingUnit[] = [];
  let current: TranscriptWord[] = [];

  const flush = () => {
    const text = current.map((w) => w.text).join(" ").replace(/\s+/g, " ").trim();
    if (text.length > 0) {
      units.push({
        id: `U${units.length + 1}`,
        text,
        startMs: current[0]!.startMs,
        endMs: current[current.length - 1]!.endMs,
        source: "EXPLICIT_TEACHING",
      });
    }
    current = [];
  };

  transcript.words.forEach((word, index) => {
    const prev = current[current.length - 1];
    if (prev && current.length > 0) {
      const longPause = word.startMs - prev.endMs >= pauseMs;
      const tooLong = word.endMs - current[0]!.startMs > maxUnitMs;
      if (tooLong || (longPause && word.endMs - current[0]!.startMs > maxUnitMs / 2)) flush();
    }
    current.push(word);
    if (SENTENCE_END.test(word.text) || index === transcript.words.length - 1) flush();
  });
  return units;
}
