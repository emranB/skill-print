import { afterEach, describe, expect, it, vi } from "vitest";
import { CameraManager, isSupersededError } from "../../src/frontend/media/CameraManager";

interface FakeTrack {
  readyState: "live" | "ended";
  stop: () => void;
}

function fakeStream() {
  const track: FakeTrack = { readyState: "live", stop: () => (track.readyState = "ended") };
  return { track, stream: { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] } };
}

function stubGetUserMedia(results: Array<ReturnType<typeof fakeStream>>) {
  const pending: Array<() => void> = [];
  const getUserMedia = vi.fn(
    () =>
      new Promise((resolve) => {
        const next = results[pending.length]!;
        pending.push(() => resolve(next.stream));
      }),
  );
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  return pending;
}

afterEach(() => vi.unstubAllGlobals());

describe("CameraManager", () => {
  it("stops a stream that resolves after a newer request instead of leaking it", async () => {
    const first = fakeStream();
    const second = fakeStream();
    const resolvers = stubGetUserMedia([first, second]);
    const manager = new CameraManager();
    const a = manager.acquire({ video: true });
    const b = manager.acquire({ video: true });
    resolvers[1]!();
    resolvers[0]!();
    await expect(b).resolves.toBe(second.stream);
    await a.then(
      () => expect.unreachable(),
      (error: unknown) => expect(isSupersededError(error)).toBe(true),
    );
    expect(first.track.readyState).toBe("ended");
    expect(second.track.readyState).toBe("live");
    manager.releaseAll();
    expect(second.track.readyState).toBe("ended");
  });

  it("stops a stream that resolves after releaseAll", async () => {
    const only = fakeStream();
    const resolvers = stubGetUserMedia([only]);
    const manager = new CameraManager();
    const pending = manager.acquire({ video: true });
    manager.releaseAll();
    resolvers[0]!();
    await pending.catch(() => undefined);
    expect(only.track.readyState).toBe("ended");
    expect(manager.getStream()).toBeNull();
  });

  it("reuses a live video stream instead of opening a second camera", async () => {
    const first = fakeStream();
    const resolvers = stubGetUserMedia([first]);
    const manager = new CameraManager();
    const pending = manager.acquire({ video: true, audio: false });
    resolvers[0]!();
    await pending;
    await manager.ensure({ video: true, audio: false });
    expect(manager.getStream()).toBe(first.stream);
    expect(first.track.readyState).toBe("live");
  });

  it("notifies subscribers when the camera starts and stops", async () => {
    const first = fakeStream();
    const resolvers = stubGetUserMedia([first]);
    const manager = new CameraManager();
    const seen: string[] = [];
    manager.subscribe(() => seen.push(manager.isVideoLive() ? "on" : "off"));
    const pending = manager.acquire({ video: true });
    resolvers[0]!();
    await pending;
    manager.releaseAll();
    expect(seen).toEqual(["on", "off"]);
  });
});
