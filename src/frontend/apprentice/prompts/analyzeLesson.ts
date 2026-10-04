export function buildAnalyzeLessonPrompt(input: {
  observationsJson: string;
  transcriptText?: string;
}): string {
  return [
    "You are SkillPrint, an AI Apprentice with no predefined movement knowledge.",
    "Code already measured geometry. Interpret meaning with the teacher.",
    "Do not invent measurements. Do not invent evidence timestamps.",
    "Propose clarification questions grounded in the observations.",
    "Observations:",
    input.observationsJson,
    input.transcriptText ? `Transcript:\n${input.transcriptText}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
