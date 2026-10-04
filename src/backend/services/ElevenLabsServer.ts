import { loadEnv } from "../config/env.js";

export function hasElevenLabsCredentials(): boolean {
  const env = loadEnv();
  return Boolean(env.elevenLabsApiKey && env.elevenLabsAgentId);
}

export function getElevenLabsAgentId(): string | undefined {
  return loadEnv().elevenLabsAgentId;
}

/** Server-only access. Never send the API key to the browser. */
export function getElevenLabsApiKey(): string | undefined {
  return loadEnv().elevenLabsApiKey;
}

export interface ScribeWord {
  text: string;
  startMs: number;
  endMs: number;
}

export interface ScribeResult {
  words: ScribeWord[];
  fullText: string;
  audioDurationSecs?: number;
}

function extensionForMime(mimeType: string): string {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "bin";
}

/**
 * ElevenLabs Scribe v2 transcription.
 * API key remains server-side only. Accepts audio or video containers.
 */
export async function transcribeWithScribe(
  audio: Buffer,
  mimeType: string,
  originalName?: string,
): Promise<ScribeResult> {
  const apiKey = getElevenLabsApiKey();
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY missing");
  }

  const form = new FormData();
  const filename =
    originalName || `media.${extensionForMime(mimeType || "application/octet-stream")}`;
  const blob = new Blob([Uint8Array.from(audio)], {
    type: mimeType || "application/octet-stream",
  });
  form.append("file", blob, filename);
  form.append("model_id", "scribe_v2");
  form.append("timestamps_granularity", "word");

  const response = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
    },
    body: form,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Scribe failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as {
    text?: string;
    audio_duration_secs?: number;
    words?: Array<{ text?: string; start?: number; end?: number; type?: string }>;
  };

  const words: ScribeWord[] = (json.words ?? [])
    .filter((w) => (w.type ?? "word") === "word" || !w.type)
    .filter((w) => Boolean(w.text && w.text.trim() && w.text !== " "))
    .map((w) => ({
      text: w.text ?? "",
      startMs: Math.round((w.start ?? 0) * 1000),
      endMs: Math.round((w.end ?? 0) * 1000),
    }));

  return {
    words,
    fullText: json.text ?? words.map((w) => w.text).join(" "),
    audioDurationSecs: json.audio_duration_secs,
  };
}
