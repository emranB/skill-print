import { describe, expect, it } from "vitest";
import {
  APP_INSTRUCTION_PREFIX,
  LIVE_INTERVIEW,
  LiveInterviewer,
  LiveVoiceChannel,
  describeRecentMotion,
  excludeWindows,
  liveEntriesToQuestions,
} from "../../src/frontend/apprentice/LiveInterview";
import type { Landmark } from "../../src/frontend/pose/pose.types";

function pose(kneeY: number): Landmark[] {
  return Array.from({ length: 33 }, (_, i) => ({
    x: 0.5,
    y: i === 25 || i === 26 || i === 23 || i === 24 ? kneeY : 0.4,
    z: 0,
    visibility: 0.9,
  }));
}

function connected(): { channel: LiveVoiceChannel; asked: string[] } {
  const channel = new LiveVoiceChannel();
  const asked: string[] = [];
  channel.attach({ ask: (text) => asked.push(text) });
  return { channel, asked };
}

describe("LiveInterviewer", () => {
  it("asks after the first delay, records the spoken reply and closes the mic again", () => {
    const { channel, asked } = connected();
    const interviewer = new LiveInterviewer({ channel, skillName: "Hinge", floor: 0.5 });
    interviewer.start();
    expect(channel.getPolicy()).toEqual({ interviewMode: true, listening: false });

    for (let t = 0; t < LIVE_INTERVIEW.firstQuestionAfterMs; t += 500) {
      interviewer.observe(t, pose(0.6 + (t % 2000) / 10_000));
      interviewer.tick(t);
    }
    expect(asked).toHaveLength(0);
    interviewer.tick(LIVE_INTERVIEW.firstQuestionAfterMs);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain(APP_INSTRUCTION_PREFIX);
    expect(asked[0]).toContain("Hinge");
    expect(asked[0]).toContain("hips and knees");

    channel.receive({ source: "ai", text: "Why do you push the hips back first?" });
    expect(channel.getPolicy().listening).toBe(true);
    interviewer.observe(LIVE_INTERVIEW.firstQuestionAfterMs + 4000, pose(0.6));
    channel.receive({ source: "user", text: "It keeps the load off the knees." });
    expect(channel.getPolicy().listening).toBe(false);

    const result = interviewer.stop();
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]).toMatchObject({
      gapType: "why",
      question: "Why do you push the hips back first?",
      answer: "It keeps the load off the knees.",
    });
    expect(result.windows).toHaveLength(1);
    expect(channel.getPolicy()).toEqual({ interviewMode: false, listening: false });
  });

  it("ignores teacher speech when no question is pending and skips a question nobody answers", () => {
    const { channel, asked } = connected();
    const interviewer = new LiveInterviewer({ channel, floor: 0.5 });
    interviewer.start();
    channel.receive({ source: "user", text: "Narration before any question" });
    interviewer.tick(LIVE_INTERVIEW.firstQuestionAfterMs);
    channel.receive({ source: "ai", text: "What should a beginner feel here?" });
    interviewer.tick(LIVE_INTERVIEW.firstQuestionAfterMs + LIVE_INTERVIEW.answerTimeoutMs + 1);
    expect(channel.getPolicy().listening).toBe(false);
    const result = interviewer.stop();
    expect(asked).toHaveLength(1);
    expect(result.entries).toHaveLength(0);
    expect(result.windows).toHaveLength(1);
  });

  it("does nothing without a voice session", () => {
    const channel = new LiveVoiceChannel();
    const interviewer = new LiveInterviewer({ channel, floor: 0.5 });
    interviewer.start();
    interviewer.tick(60_000);
    expect(interviewer.view().phase).toBe("waiting");
    expect(interviewer.stop().entries).toHaveLength(0);
  });
});

describe("live interview helpers", () => {
  it("describes a still body as holding a position", () => {
    const frames = Array.from({ length: 6 }, (_, i) => ({ t: i * 100, landmarks: pose(0.6) }));
    expect(describeRecentMotion(frames, 0.5)).toBe("The teacher is mostly holding a position.");
  });

  it("removes narration words spoken inside an interview window", () => {
    const words = [
      { text: "keep", startMs: 1000, endMs: 1200 },
      { text: "why", startMs: 5000, endMs: 5200 },
      { text: "back", startMs: 9000, endMs: 9200 },
    ];
    expect(excludeWindows(words, [{ startMs: 4000, endMs: 6000 }]).map((w) => w.text)).toEqual(["keep", "back"]);
  });

  it("turns live answers into answered capture questions marked as asked live", () => {
    const [q] = liveEntriesToQuestions([
      {
        id: "LQ1",
        gapType: "failure",
        question: "What usually goes wrong?",
        answer: "The back rounds.",
        observation: "Most movement just now was at the hips and knees.",
        askedAtMs: 12_000,
        answeredAtMs: 18_000,
      },
    ]);
    expect(q).toMatchObject({
      phase: "capture_review",
      type: "guardrail",
      status: "answered",
      answer: "The back rounds.",
      askedLive: true,
      clipEndMs: 12_000,
    });
  });
});
