import { useConversation } from "@elevenlabs/react";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useApp } from "../app/AppContext";
import type { AppState } from "../app/app.types";
import { DebugBus } from "../debug/DebugBus";
import { useApprentice } from "./ApprenticeProvider";
import { ElevenLabsGateway } from "./ElevenLabsGateway";
import { liveVoice, type VoicePort } from "./LiveInterview";
import { voiceStatus } from "./voiceStatus";

/** States that end the workflow; the voice session must not outlive them. */
const TERMINAL_STATES: ReadonlySet<AppState> = new Set<AppState>(["HOME", "TEACH_COMPLETE", "LEARN_COMPLETE"]);

/** Live teaching connects early so the greeting finishes before recording starts. */
const LIVE_TEACH_STATES: ReadonlySet<AppState> = new Set<AppState>(["TEACH_READY", "TEACH_RECORDING"]);

async function fetchSignedUrl(): Promise<string> {
  const response = await fetch("/api/elevenlabs/session", { method: "POST" });
  const body = (await response.json().catch(() => ({}))) as { signedUrl?: string; message?: string };
  if (!response.ok || !body.signedUrl) {
    throw new Error(body.message ?? `Voice session unavailable (${response.status})`);
  }
  return body.signedUrl;
}

/**
 * Real-time voice apprentice over the existing ElevenLabs agent.
 * The application stays authoritative: the agent only receives compact
 * contextual updates and cannot change workflow state. During live teaching
 * the mic stays closed except while the teacher answers a spoken question.
 */
export function ApprenticeVoice() {
  const { state, inputSource } = useApp();
  const gateway = useApprentice();
  const [failure, setFailure] = useState<string | null>(null);
  const [modeKnown, setModeKnown] = useState(false);
  const policy = useSyncExternalStore(liveVoice.subscribePolicy, () => liveVoice.getPolicy());
  const conversation = useConversation({
    micMuted: policy.interviewMode && !policy.listening,
    onConnect: () => {
      setFailure(null);
      DebugBus.emit({ category: "AI", event: "VOICE_CONNECTED" });
    },
    onDisconnect: (details) => {
      setModeKnown(false);
      DebugBus.emit({ category: "AI", event: "VOICE_DISCONNECTED", data: { reason: details.reason } });
    },
    onError: (message) => {
      setFailure(message);
      DebugBus.emit({ category: "AI", level: "warn", event: "VOICE_ERROR", message });
    },
    onMessage: ({ message, source }) => {
      setModeKnown(true);
      liveVoice.receive({ source: source === "ai" ? "ai" : "user", text: message });
    },
  });
  const { status, isSpeaking, startSession, endSession, sendContextualUpdate, sendUserMessage } = conversation;
  const connectedRef = useRef(false);
  const endRef = useRef(endSession);
  const sendRef = useRef(sendContextualUpdate);
  const askRef = useRef(sendUserMessage);
  const previousStateRef = useRef(state);
  const autoStartedRef = useRef(false);
  const userEndedRef = useRef(false);
  connectedRef.current = status === "connected" || status === "connecting";
  endRef.current = endSession;
  sendRef.current = sendContextualUpdate;
  askRef.current = sendUserMessage;

  const stop = useCallback(async () => {
    if (!connectedRef.current) return;
    try {
      await endRef.current();
    } catch {
      // Session already closed by the server.
    }
  }, []);

  const start = useCallback(async () => {
    setFailure(null);
    userEndedRef.current = false;
    try {
      const signedUrl = await fetchSignedUrl();
      await startSession({ signedUrl, connectionType: "websocket" });
    } catch (error) {
      setFailure(error instanceof Error ? error.message : "Could not start the apprentice");
    }
  }, [startSession]);

  const endByUser = useCallback(() => {
    userEndedRef.current = true;
    void stop();
  }, [stop]);

  useEffect(() => {
    const liveTeach = inputSource === "live" && LIVE_TEACH_STATES.has(state);
    if (!liveTeach) {
      autoStartedRef.current = false;
      return;
    }
    if (autoStartedRef.current || userEndedRef.current || status !== "disconnected") return;
    autoStartedRef.current = true;
    DebugBus.emit({ category: "AI", event: "VOICE_AUTO_START", data: { state } });
    void start();
  }, [inputSource, start, state, status]);

  useEffect(() => {
    if (status !== "connected") return undefined;
    const port: VoicePort = { ask: (text) => askRef.current(text) };
    liveVoice.attach(port);
    return () => liveVoice.detach(port);
  }, [status]);

  useEffect(() => {
    if (!(gateway instanceof ElevenLabsGateway)) return undefined;
    if (status !== "connected") {
      gateway.setContextualSender(undefined);
      return undefined;
    }
    gateway.setContextualSender((text) => sendRef.current(text));
    return () => gateway.setContextualSender(undefined);
  }, [gateway, status]);

  useEffect(() => {
    if (status !== "connected") return;
    sendRef.current(`SkillPrint state: ${state}`);
  }, [state, status]);

  useEffect(() => {
    const previous = previousStateRef.current;
    previousStateRef.current = state;
    if (previous !== state && TERMINAL_STATES.has(state)) void stop();
  }, [state, stop]);

  useEffect(() => () => void stop(), [stop]);

  const label = voiceStatus(status, isSpeaking, Boolean(failure), modeKnown);
  const active = status === "connected" || status === "connecting";
  const micNote = active && policy.interviewMode ? (policy.listening ? "Mic open for your answer" : "Mic closed while you teach") : null;

  return (
    <div className="voice-status voice-card" data-testid="apprentice-voice">
      <span className={`tag voice-tag${isSpeaking ? " speaking" : ""}`} data-testid="voice-status">
        {label}
      </span>
      {micNote ? (
        <span className={`tag mic-tag${policy.listening ? " open" : ""}`} data-testid="voice-mic">
          {micNote}
        </span>
      ) : null}
      {active ? (
        <button type="button" className="secondary" onClick={endByUser}>
          End Apprentice
        </button>
      ) : (
        <button type="button" className="primary" onClick={() => void start()}>
          Start Apprentice
        </button>
      )}
      {failure ? <p className="error-text">{failure}</p> : null}
    </div>
  );
}
