import type { KnowledgeGapType, CaptureReviewQuestion } from "../analyze/analyze.types";
import type { SessionTimeMs } from "../clock/clock.types";
import { DebugBus } from "../debug/DebugBus";
import type { Landmark } from "../pose/pose.types";

/** One spoken clarifying question during live teaching, with the teacher's spoken reply. */
export interface LiveInterviewEntry {
  id: string;
  gapType: KnowledgeGapType;
  question: string;
  answer: string;
  observation: string;
  askedAtMs: SessionTimeMs;
  answeredAtMs: SessionTimeMs;
}

/** Session-time span in which the apprentice and teacher spoke to each other. */
export interface InterviewWindow {
  startMs: SessionTimeMs;
  endMs: SessionTimeMs;
}

export interface LiveInterviewResult {
  entries: LiveInterviewEntry[];
  windows: InterviewWindow[];
}

/** Trailing margin so the end of the spoken reply is not counted as narration. */
const WINDOW_TAIL_MS = 1_500;

export type VoiceSource = "ai" | "user";

export interface VoiceMessage {
  source: VoiceSource;
  text: string;
}

/** What the live voice session exposes to the interviewer. */
export interface VoicePort {
  ask(instruction: string): void;
}

export interface MicPolicy {
  /** Live teaching: the mic stays closed so the agent does not answer the narration. */
  interviewMode: boolean;
  /** Open the mic for the teacher's reply to a question. */
  listening: boolean;
}

/**
 * Bridges the side-panel voice session and the Teach flow, which live in
 * separate React trees. The voice component attaches a port and forwards
 * transcripts; the interviewer asks through the port and sets the mic policy.
 */
export class LiveVoiceChannel {
  private port: VoicePort | null = null;
  private readonly messageListeners = new Set<(message: VoiceMessage) => void>();
  private readonly policyListeners = new Set<() => void>();
  private policy: MicPolicy = { interviewMode: false, listening: false };

  attach(port: VoicePort): void {
    this.port = port;
    this.notifyPolicy();
  }

  detach(port: VoicePort): void {
    if (this.port === port) this.port = null;
    this.notifyPolicy();
  }

  get connected(): boolean {
    return this.port !== null;
  }

  ask(instruction: string): boolean {
    if (!this.port) return false;
    this.port.ask(instruction);
    return true;
  }

  receive(message: VoiceMessage): void {
    for (const listener of this.messageListeners) listener(message);
  }

  onMessage(listener: (message: VoiceMessage) => void): () => void {
    this.messageListeners.add(listener);
    return () => this.messageListeners.delete(listener);
  }

  setPolicy(next: Partial<MicPolicy>): void {
    const merged = { ...this.policy, ...next };
    if (merged.interviewMode === this.policy.interviewMode && merged.listening === this.policy.listening) return;
    this.policy = merged;
    this.notifyPolicy();
  }

  getPolicy(): MicPolicy {
    return this.policy;
  }

  subscribePolicy = (listener: () => void): (() => void) => {
    this.policyListeners.add(listener);
    return () => this.policyListeners.delete(listener);
  };

  private notifyPolicy(): void {
    for (const listener of this.policyListeners) listener();
  }
}

export const liveVoice = new LiveVoiceChannel();

/** Prefix that marks an app instruction, so it is never mistaken for the teacher's words. */
export const APP_INSTRUCTION_PREFIX = "[SkillPrint app instruction, not the teacher]";

/** Generic knowledge each live question targets, in asking order. Nothing here is skill specific. */
const LIVE_GAPS: ReadonlyArray<{ type: KnowledgeGapType; focus: string }> = [
  { type: "why", focus: "why the part of the movement just shown matters" },
  { type: "attention", focus: "what a beginner should watch or feel while doing it" },
  { type: "failure", focus: "the most common mistake and how a learner would notice it" },
  { type: "boundary", focus: "how far the movement should go and when a learner should stop" },
];

export const LIVE_INTERVIEW = {
  firstQuestionAfterMs: 8_000,
  gapBetweenQuestionsMs: 12_000,
  maxQuestions: 3,
  askTimeoutMs: 15_000,
  answerTimeoutMs: 25_000,
  motionWindowMs: 6_000,
} as const;

const BODY_REGIONS: ReadonlyArray<{ name: string; joints: number[] }> = [
  { name: "hips and knees", joints: [23, 24, 25, 26] },
  { name: "ankles and feet", joints: [27, 28] },
  { name: "arms", joints: [13, 14, 15, 16] },
  { name: "shoulders and upper back", joints: [11, 12] },
];

interface TimedPose {
  t: SessionTimeMs;
  landmarks: Landmark[];
}

/**
 * The body region that moved the most in recent frames, in plain words.
 * Deterministic geometry: the agent only phrases the question around it.
 */
export function describeRecentMotion(frames: TimedPose[], floor: number): string | null {
  if (frames.length < 4) return null;
  let best: { name: string; range: number } | null = null;
  for (const region of BODY_REGIONS) {
    let total = 0;
    let counted = 0;
    for (const joint of region.joints) {
      const ys = frames
        .map((f) => f.landmarks[joint])
        .filter((p): p is Landmark => Boolean(p) && (p?.visibility ?? 0) >= floor)
        .map((p) => p.y);
      if (ys.length < 3) continue;
      total += Math.max(...ys) - Math.min(...ys);
      counted += 1;
    }
    if (counted === 0) continue;
    const range = total / counted;
    if (!best || range > best.range) best = { name: region.name, range };
  }
  if (!best || best.range < 0.03) return "The teacher is mostly holding a position.";
  return `Most movement just now was at the ${best.name}.`;
}

export type InterviewPhase = "waiting" | "asking" | "listening" | "done";

export interface InterviewView {
  phase: InterviewPhase;
  question: string | null;
  answered: number;
}

interface InterviewerOptions {
  channel: LiveVoiceChannel;
  skillName?: string;
  floor: number;
  onChange?: (view: InterviewView) => void;
}

/**
 * Asks a few short spoken clarifying questions while the expert records.
 * Timing and the knowledge gap are chosen here; the agent only phrases the
 * question. Each reply is kept for the review screens after recording.
 */
export class LiveInterviewer {
  private readonly channel: LiveVoiceChannel;
  private readonly skillName?: string;
  private readonly floor: number;
  private readonly onChange?: (view: InterviewView) => void;
  private readonly entries: LiveInterviewEntry[] = [];
  private readonly windows: InterviewWindow[] = [];
  private readonly frames: TimedPose[] = [];
  private phase: InterviewPhase = "waiting";
  private phaseStartedAt = 0;
  private now = 0;
  private lastFinishedAt = 0;
  private gapIndex = 0;
  private pending: { gap: KnowledgeGapType; observation: string; askedAtMs: number; question?: string } | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(options: InterviewerOptions) {
    this.channel = options.channel;
    this.skillName = options.skillName;
    this.floor = options.floor;
    this.onChange = options.onChange;
  }

  start(): void {
    this.unsubscribe = this.channel.onMessage((message) => this.handleMessage(message));
    this.channel.setPolicy({ interviewMode: true, listening: false });
    this.emit();
  }

  stop(): LiveInterviewResult {
    if (this.pending) this.windows.push({ startMs: this.pending.askedAtMs, endMs: this.now + WINDOW_TAIL_MS });
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.channel.setPolicy({ interviewMode: false, listening: false });
    this.phase = "done";
    this.pending = null;
    this.emit();
    return { entries: [...this.entries], windows: [...this.windows] };
  }

  observe(t: SessionTimeMs, landmarks: Landmark[]): void {
    this.now = Math.max(this.now, t);
    this.frames.push({ t, landmarks });
    const cutoff = t - LIVE_INTERVIEW.motionWindowMs;
    while (this.frames.length > 0 && this.frames[0]!.t < cutoff) this.frames.shift();
  }

  tick(now: SessionTimeMs): void {
    this.now = Math.max(this.now, now);
    if (this.phase === "asking" && now - this.phaseStartedAt > LIVE_INTERVIEW.askTimeoutMs) {
      this.skip(now, "no spoken question");
      return;
    }
    if (this.phase === "listening" && now - this.phaseStartedAt > LIVE_INTERVIEW.answerTimeoutMs) {
      this.skip(now, "no answer");
      return;
    }
    if (this.phase !== "waiting" || !this.channel.connected) return;
    if (this.entries.length >= LIVE_INTERVIEW.maxQuestions || this.gapIndex >= LIVE_GAPS.length) return;
    const due =
      this.gapIndex === 0
        ? now >= LIVE_INTERVIEW.firstQuestionAfterMs
        : now - this.lastFinishedAt >= LIVE_INTERVIEW.gapBetweenQuestionsMs;
    if (!due) return;
    this.ask(now);
  }

  view(): InterviewView {
    return { phase: this.phase, question: this.pending?.question ?? null, answered: this.entries.length };
  }

  private ask(now: SessionTimeMs): void {
    const gap = LIVE_GAPS[this.gapIndex]!;
    this.gapIndex += 1;
    const observation = describeRecentMotion(this.frames, this.floor) ?? "The teacher is demonstrating.";
    const known = this.entries.map((e) => `- ${e.answer}`).join("\n");
    const instruction = [
      APP_INSTRUCTION_PREFIX,
      `The expert is recording a live lesson${this.skillName ? ` called "${this.skillName}"` : ""}.`,
      `Observed: ${observation}`,
      `Ask the teacher ONE short spoken clarifying question (at most 20 words) about ${gap.focus}.`,
      "Use plain body words. Do not answer it yourself, do not greet, do not add anything else, then wait for the reply.",
      known ? `Already answered, do not ask again:\n${known}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    if (!this.channel.ask(instruction)) {
      this.gapIndex -= 1;
      return;
    }
    this.pending = { gap: gap.type, observation, askedAtMs: now };
    this.setPhase("asking", now);
    DebugBus.emit({ category: "AI", event: "LIVE_QUESTION_REQUESTED", data: { gap: gap.type, atMs: Math.round(now) } });
  }

  private handleMessage(message: VoiceMessage): void {
    const text = message.text.trim();
    if (!text || !this.pending || text.startsWith(APP_INSTRUCTION_PREFIX)) return;
    if (message.source === "ai" && this.phase === "asking") {
      this.pending.question = text;
      this.channel.setPolicy({ listening: true });
      this.setPhase("listening", this.now);
      DebugBus.emit({ category: "AI", event: "LIVE_QUESTION_ASKED", data: { gap: this.pending.gap, question: text } });
      return;
    }
    if (message.source === "user" && this.phase === "listening" && this.pending.question) {
      const answeredAtMs = Math.max(this.now, this.pending.askedAtMs);
      this.entries.push({
        id: `LQ${this.entries.length + 1}`,
        gapType: this.pending.gap,
        question: this.pending.question,
        answer: text,
        observation: this.pending.observation,
        askedAtMs: this.pending.askedAtMs,
        answeredAtMs,
      });
      DebugBus.emit({
        category: "AI",
        event: "LIVE_ANSWER_RECORDED",
        data: { gap: this.pending.gap, words: text.split(/\s+/).length },
      });
      this.finish(answeredAtMs);
    }
  }

  private skip(now: SessionTimeMs, reason: string): void {
    DebugBus.emit({
      category: "AI",
      level: "warn",
      event: "LIVE_QUESTION_SKIPPED",
      data: { gap: this.pending?.gap, reason },
    });
    this.finish(now);
  }

  private finish(now: SessionTimeMs): void {
    if (this.pending) this.windows.push({ startMs: this.pending.askedAtMs, endMs: now + WINDOW_TAIL_MS });
    this.pending = null;
    this.lastFinishedAt = now;
    this.channel.setPolicy({ listening: false });
    this.setPhase("waiting", now);
  }

  private setPhase(phase: InterviewPhase, now: SessionTimeMs): void {
    this.phase = phase;
    this.phaseStartedAt = now;
    this.emit();
  }

  private emit(): void {
    this.onChange?.(this.view());
  }
}

/** Seconds of context replayed before a live question in the review screens. */
const LIVE_CLIP_BEFORE_MS = 5_000;

/**
 * Live answers enter the same review as the post-recording questions:
 * pre-filled capture questions the expert can edit, then debrief and teach-back.
 */
export function liveEntriesToQuestions(entries: LiveInterviewEntry[]): CaptureReviewQuestion[] {
  return entries.map((entry) => ({
    id: entry.id,
    phase: "capture_review",
    type: entry.gapType === "failure" ? "guardrail" : entry.gapType === "why" ? "reason" : "importance",
    question: entry.question,
    evidence: [{ feature: "live_observation", description: entry.observation, startMs: entry.askedAtMs }],
    rationale: `Asked aloud during recording (${entry.gapType})`,
    confidence: 0.6,
    answer: entry.answer,
    status: "answered",
    gapType: entry.gapType,
    askedLive: true,
    timestampMs: entry.askedAtMs,
    clipStartMs: Math.max(0, entry.askedAtMs - LIVE_CLIP_BEFORE_MS),
    clipEndMs: entry.askedAtMs,
  }));
}

/** Drops narration words spoken inside interview windows; those words are questions and answers, not narration. */
export function excludeWindows<T extends { startMs: number; endMs: number }>(
  words: T[],
  windows: InterviewWindow[],
): T[] {
  if (windows.length === 0) return words;
  return words.filter((w) => !windows.some((win) => w.endMs > win.startMs && w.startMs < win.endMs));
}
