import { DebugBus } from "../debug/DebugBus";
import type { Transcript } from "./analyze.types";

export async function transcribeMediaBlob(file: Blob, filename = "media.bin"): Promise<Transcript> {
  const started = performance.now();
  const form = new FormData();
  form.append("file", file, filename);

  DebugBus.emit({
    category: "TRANSCRIPT",
    event: "TRANSCRIBE_REQUEST",
    data: {
      bytes: file.size,
      mimeType: file.type || "unknown",
      filename,
    },
  });

  const response = await fetch("/api/transcribe", {
    method: "POST",
    body: form,
  });

  const elapsedMs = Math.round(performance.now() - started);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
      message?: string;
    };
    DebugBus.emit({
      category: "TRANSCRIPT",
      level: "error",
      event: "TRANSCRIBE_FAILED",
      data: {
        status: response.status,
        error: body.error,
        message: body.message,
        elapsedMs,
      },
    });
    throw new Error(body.message ?? `Transcription failed (${response.status})`);
  }

  const json = (await response.json()) as Transcript & {
    words: Array<{ text: string; startMs: number; endMs: number }>;
  };

  const words = (json.words ?? []).filter((w) => w.text && w.text.trim() && w.text !== " ");
  const transcript: Transcript = {
    schemaVersion: 1,
    words,
    fullText: json.fullText ?? words.map((w) => w.text).join(" "),
  };

  const first = words[0]?.startMs;
  const last = words[words.length - 1]?.endMs;
  DebugBus.emit({
    category: "TRANSCRIPT",
    event: "TRANSCRIBE_COMPLETE",
    data: {
      elapsedMs,
      wordCount: words.length,
      timestampRangeMs:
        first === undefined || last === undefined ? null : { startMs: first, endMs: last },
      textPreview: (transcript.fullText ?? "").slice(0, 240),
    },
  });

  return transcript;
}
