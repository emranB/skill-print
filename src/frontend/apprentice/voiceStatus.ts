export type VoiceStatus = "Disconnected" | "Connecting" | "Connected" | "Listening" | "Speaking" | "Error";

/** Map SDK connection state to the statuses shown to the user. */
export function voiceStatus(
  sdkStatus: "connecting" | "connected" | "disconnecting" | "disconnected",
  isSpeaking: boolean,
  failed: boolean,
  modeKnown: boolean,
): VoiceStatus {
  if (failed) return "Error";
  if (sdkStatus === "connecting") return "Connecting";
  if (sdkStatus !== "connected") return "Disconnected";
  if (isSpeaking) return "Speaking";
  return modeKnown ? "Listening" : "Connected";
}
