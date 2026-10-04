export function buildReviewLessonPrompt(input: {
  answeredSummary: string;
}): string {
  return [
    "Continue the Map/Debrief. Ask non-repeating follow-ups.",
    "Then teach back what you learned and ask the expert to confirm or correct.",
    "Answered so far:",
    input.answeredSummary,
  ].join("\n");
}
