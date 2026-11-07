import { z } from "zod";

/** Same region contract at persistence and the production worker boundary. */
export function observedRegionSchema<T extends z.ZodTypeAny>(pose: T) {
  return z.object({ startSourceIndex: z.number().int().nonnegative(), endSourceIndex: z.number().int().nonnegative(),
    startMs: z.number().finite().nonnegative(), endMs: z.number().finite().nonnegative(),
    samples: z.array(pose).min(1).max(4096), diameter: z.number().finite().nonnegative(), maximumSpeed: z.number().finite().nonnegative() });
}

export function referenceQualitySchema<T extends z.ZodTypeAny>(pose: T) {
  const region = observedRegionSchema(pose);
  return z.object({ regions: z.object({ start: region.optional(), turnaround: region.optional(), completion: region.optional() }),
    sourceSamples: z.number().int().nonnegative(), reliableSamples: z.number().int().nonnegative(),
    nominalIntervalMs: z.number().finite().nonnegative(), largestConfidenceGapMs: z.number().finite().nonnegative(),
    excursion: z.number().finite().nonnegative(), regionRadius: z.number().finite().nonnegative(), stableSpeed: z.number().finite().nonnegative(),
    gaps: z.array(z.object({ beforeSourceIndex: z.number().int().nonnegative(), afterSourceIndex: z.number().int().nonnegative(),
      durationMs: z.number().finite().nonnegative(), missingSamples: z.number().int().nonnegative(), distance: z.number().finite().nonnegative().nullable(), coherent: z.boolean(), reason: z.string() })),
    rejectionReasons: z.array(z.string()) });
}
