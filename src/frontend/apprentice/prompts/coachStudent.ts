export function buildCoachStudentPrompt(input: {
  mismatchSummary: string;
  expectedCheckpoint: string;
  knowledgeHints: string[];
}): string {
  return [
    "Give one concise coaching cue.",
    "Do not invent geometry. Use the mismatch summary.",
    `Expected checkpoint: ${input.expectedCheckpoint}`,
    `Mismatch: ${input.mismatchSummary}`,
    `Learned hints: ${input.knowledgeHints.join("; ")}`,
  ].join("\n");
}
