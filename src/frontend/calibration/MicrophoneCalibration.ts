import { cameraManager } from "../media/CameraManager";
import { DebugBus } from "../debug/DebugBus";

export interface MicrophoneCheck {
  /** A live audio track is being captured. A quiet room is still a working microphone. */
  available: boolean;
  /** Peak RMS over the sampling window, for diagnostics only. */
  peakRms: number;
}

export async function measureMicrophoneLevel(windowMs = 800): Promise<MicrophoneCheck> {
  const audio = cameraManager.getAudioStream();
  const available = Boolean(audio?.getAudioTracks().some((t) => t.readyState === "live"));
  if (!audio || !available) return { available, peakRms: 0 };

  let peakRms = 0;
  try {
    const context = new AudioContext();
    const source = context.createMediaStreamSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);
    const data = new Uint8Array(analyser.frequencyBinCount);
    const deadline = performance.now() + windowMs;
    while (performance.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) {
        const v = (sample - 128) / 128;
        sum += v * v;
      }
      peakRms = Math.max(peakRms, Math.sqrt(sum / data.length));
    }
    await context.close();
  } catch {
    // Level is diagnostic only; the track itself is what matters.
  }
  DebugBus.emit({ category: "CALIBRATION", event: "MICROPHONE_LEVEL", data: { available, peakRms } });
  return { available, peakRms };
}

/** Deterministic stub until Gate 8 transcription. */
export function confirmCalibrationPhrase(heard: string, expected = "blue river seven"): boolean {
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
  const a = normalize(heard);
  const b = normalize(expected);
  if (!a) return false;
  if (a === b) return true;
  const aTokens = new Set(a.split(/\s+/));
  const bTokens = b.split(/\s+/);
  const hits = bTokens.filter((t) => aTokens.has(t)).length;
  return hits >= Math.ceil(bTokens.length * 0.66);
}
