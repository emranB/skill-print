import { z } from "zod";
import { extractJsonObject, runApprenticeTextTurns } from "./ApprenticeTextSession.js";

/**
 * Structured (non-voice) apprentice tasks run against the existing agent in
 * text-only mode. The agent caps replies at a few hundred tokens, so work is
 * split into small batches and each reply is a compact JSON object. The
 * browser validates every reply again with Zod before using it.
 */

const KINDS =
  "instruction,technique,target,reason,warning,modification,exception,progression,sequencing,prescription,emphasis,unknown";

const HEADER =
  "APPLICATION TASK (structured mode, not a spoken reply). Reply with ONLY one minified JSON object. No markdown, no prose. Use only the text given; never add knowledge the speaker did not state.";

export const ExtractInputSchema = z.object({
  units: z
    .array(
      z.object({
        i: z.number().int().nonnegative(),
        text: z.string().min(1).max(1200),
        startMs: z.number().optional(),
        endMs: z.number().optional(),
        question: z.string().max(400).optional(),
      }),
    )
    .min(1)
    .max(80),
});

export const PhraseInputSchema = z.object({
  phase: z.enum(["capture_review", "debrief"]),
  skill: z.string().max(120).optional(),
  known: z.array(z.string().max(200)).max(12).optional(),
  gaps: z
    .array(
      z.object({
        g: z.number().int().nonnegative(),
        type: z.string().max(40),
        quote: z.string().max(400).optional(),
        answer: z.string().max(800).optional(),
        context: z.string().max(1200).optional(),
        observed: z.string().max(400).optional(),
      }),
    )
    .min(1)
    .max(12),
});

export const TeachBackInputSchema = z.object({
  skill: z.string().max(120).optional(),
  items: z
    .array(z.object({ i: z.number().int().nonnegative(), kind: z.string().max(40), text: z.string().max(400) }))
    .min(1)
    .max(40),
});

export const LearnPrepInputSchema = z.object({
  skill: z.string().max(120),
  knowledge: z.array(z.object({ kind: z.string().max(40), text: z.string().max(240) })).max(20),
  guardrails: z.array(z.string().max(240)).max(8),
});

function extractPrompt(units: z.infer<typeof ExtractInputSchema>["units"]): string {
  const lines = units.map((u) => {
    const time = u.startMs !== undefined ? ` [${u.startMs}-${u.endMs ?? u.startMs}ms]` : "";
    const q = u.question ? ` (answer to: "${u.question}")` : "";
    return `${u.i}${time}${q} ${u.text}`;
  });
  return [
    HEADER,
    "The numbered lines are an expert teaching a physical skill. Classify each line that carries teaching content.",
    `kinds: ${KINDS}`,
    'Return {"s":[{"i":line number,"k":kind,"t":"the teaching restated in at most 14 words, in the expert\'s terms","c":confidence 0..1,"d":1 if the speaker points at what they are showing right now (this, here, like this) else 0}]}',
    "A line that makes several distinct points yields one entry per point, all with the same i.",
    "Omit lines that are only filler. Keep every line that teaches something, even briefly.",
    ...lines,
  ].join("\n");
}

function phrasePrompt(input: z.infer<typeof PhraseInputSchema>): string {
  const meaning: Record<string, string> = {
    why: "ask what goes wrong for a learner who skips this point, so the reason becomes clear",
    judgment: "ask how a learner can check on their own body, by feel or by sight, that they got it right",
    boundary: "ask how a learner knows they are ready to stop relying on this, or where the limit is",
    exception: "ask who or when this does not apply, and what to do instead",
    attention: "ask what a learner should focus on during this unnarrated repetition, referring to the observed movement",
    failure: "ask for the most common beginner mistake at this point and the first sign of it",
    uncertainty: "ask what this moment was meant to show and what a learner should copy from it",
    followup: "ask for the concrete detail the answer leaves open: how much, when, what it feels like, or how to notice it",
    priority: "ask which of the listed points a beginner should get right first, and why",
  };
  const lines = input.gaps.map((g) =>
    [
      `${g.g} type=${g.type} (${meaning[g.type] ?? "ask a grounded clarifying question"})`,
      g.quote ? ` said: "${g.quote}"` : "",
      g.answer ? ` expert answered: "${g.answer}"` : "",
      g.observed ? ` observed: ${g.observed}` : "",
      g.context ? ` nearby speech: "${g.context}"` : "",
    ].join(""),
  );
  const role =
    input.phase === "debrief"
      ? "You are an apprentice debriefing the expert after their answers."
      : "You are an apprentice reviewing the expert's teaching video with them, moment by moment.";
  return [
    HEADER,
    `${role}${input.skill ? ` The skill is "${input.skill}".` : ""} Write one question per numbered gap.`,
    "Each question must be answerable only by the expert, and its answer must give a beginner something to do or to check. Refer to the expert's own words or the specific moment. One question only, at most 25 words, not yes/no, no compound questions.",
    "observed lists measured movement with internal feature names; describe it in plain body terms if useful, never quote feature names or numbers.",
    "Omit a gap only if the nearby speech already answers exactly what its type asks. Never suggest an answer. Never introduce a skill, body part or idea the expert did not mention unless observed shows it.",
    input.known?.length
      ? `Already taught (build on these, never ask the expert to restate them): ${input.known.map((k) => `"${k}"`).join("; ")}`
      : "",
    'Return {"q":[{"g":gap number,"t":"question"}]}',
    ...lines,
  ]
    .filter(Boolean)
    .join("\n");
}

function teachBackPrompt(input: z.infer<typeof TeachBackInputSchema>): string {
  return [
    HEADER,
    `Summarize back to the expert, in first person and at most 90 words, what you learned${input.skill ? ` about "${input.skill}"` : ""}. Group related points, drop filler words and repetition, keep the expert's terms, and end with what to avoid if any warning is listed. Use only these items.`,
    'Return {"summary":"..."}',
    ...input.items.map((it) => `${it.i} (${it.kind}) ${it.text}`),
  ].join("\n");
}

function learnPrepPrompt(input: z.infer<typeof LearnPrepInputSchema>): string {
  return [
    HEADER,
    `You learned "${input.skill}" from an expert and now coach a learner who copies the movement in front of a camera.`,
    "p: one open question asked before the first attempt. Pick the single most important point below and ask the learner to predict it concretely (which body part, which direction, what to feel or check, or why), without revealing the answer. Name a specific body part or moment of the movement. Never ask generically what matters most. At most 25 words.",
    "c: for each movement phase that a point clearly fits (outbound = moving away from the start position, apex = the furthest point, return = coming back to the start), one corrective cue of at most 12 words in the expert's own terms. Omit phases no point fits.",
    'Return {"p":"question","c":[{"ph":"outbound|apex|return","t":"cue"}]}',
    ...input.knowledge.map((k, i) => `${i} (${k.kind}) ${k.text}`),
    ...input.guardrails.map((g, i) => `avoid ${i}: ${g}`),
  ].join("\n");
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

async function pool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current]!);
    }
  });
  await Promise.all(workers);
  return results;
}

/** One prompt per session; on unparseable (usually truncated) output, split the batch once. */
async function runBatch<T, R>(
  batch: T[],
  build: (batch: T[]) => string,
  pick: (json: unknown) => R[],
): Promise<R[]> {
  const [reply] = await runApprenticeTextTurns([build(batch)]);
  try {
    return pick(extractJsonObject(reply ?? ""));
  } catch (error) {
    if (batch.length <= 1) throw error;
    const mid = Math.ceil(batch.length / 2);
    const [a, b] = await Promise.all([
      runBatch(batch.slice(0, mid), build, pick),
      runBatch(batch.slice(mid), build, pick),
    ]);
    return [...a, ...b];
  }
}

const listOf = (key: string) => (json: unknown): unknown[] => {
  const value = (json as Record<string, unknown>)[key];
  if (!Array.isArray(value)) throw new Error(`Apprentice reply missing ${key}[]`);
  return value;
};

export async function extractStatements(input: z.infer<typeof ExtractInputSchema>): Promise<{ s: unknown[] }> {
  const batches = chunk(input.units, 3);
  const results = await pool(batches, 3, (batch) => runBatch(batch, extractPrompt, listOf("s")));
  return { s: results.flat() };
}

export async function phraseQuestions(input: z.infer<typeof PhraseInputSchema>): Promise<{ q: unknown[] }> {
  const batches = chunk(input.gaps, 3);
  const results = await pool(batches, 2, (gaps) =>
    runBatch(gaps, (g) => phrasePrompt({ ...input, gaps: g }), listOf("q")),
  );
  return { q: results.flat() };
}

export async function summarizeTeachBack(
  input: z.infer<typeof TeachBackInputSchema>,
): Promise<{ summary: unknown }> {
  const [reply] = await runApprenticeTextTurns([teachBackPrompt({ ...input, items: input.items.slice(0, 20) })]);
  const json = extractJsonObject(reply ?? "") as { summary?: unknown };
  return { summary: json.summary };
}

export async function prepareLearning(input: z.infer<typeof LearnPrepInputSchema>): Promise<unknown> {
  const [reply] = await runApprenticeTextTurns([learnPrepPrompt(input)]);
  return extractJsonObject(reply ?? "");
}
