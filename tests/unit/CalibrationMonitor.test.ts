import { describe, expect, it } from "vitest";
import { CalibrationMonitor } from "../../src/frontend/calibration/CalibrationMonitor";
import type { Landmark, PoseFrame } from "../../src/frontend/pose/pose.types";

/** A body lying horizontally: calibration must not assume standing or facing the camera. */
function body(t: number, vis = 0.9): PoseFrame {
  const landmarks: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: vis }));
  const place = (i: number, x: number, y: number) => (landmarks[i] = { x, y, z: 0, visibility: vis });
  place(11, 0.3, 0.48);
  place(12, 0.3, 0.52);
  place(23, 0.55, 0.48);
  place(24, 0.55, 0.52);
  place(25, 0.7, 0.48);
  place(26, 0.7, 0.52);
  place(27, 0.85, 0.48);
  place(28, 0.85, 0.52);
  return { timestampMs: t, landmarks, worldLandmarks: landmarks };
}

const signals = { cameraOk: true, microphoneLevel: 0.1, poseModelReady: true };

describe("CalibrationMonitor", () => {
  it("validates body and scale from a detected pose in any orientation", () => {
    const monitor = new CalibrationMonitor(1000, 0.5);
    monitor.update(body(0), signals);
    expect(monitor.getState().fullBody.health).toBe("valid");
    expect(monitor.getState().bodyScale.health).toBe("valid");
    expect(monitor.getState().body?.torsoLength).toBeGreaterThan(0.2);
  });

  it("never validates before any pose arrives", () => {
    const monitor = new CalibrationMonitor(1000, 0.5);
    monitor.update(null, { ...signals, nowMs: 0 });
    expect(monitor.getState().fullBody.health).toBe("lost");
    expect(monitor.bodyReady()).toBe(false);
  });

  it("rejects a partial body and a degenerate scale", () => {
    const monitor = new CalibrationMonitor(1000, 0.5);
    const partial = body(0);
    for (const i of [13, 14, 15, 16, 25, 26, 27, 28]) partial.landmarks[i] = { ...partial.landmarks[i]!, visibility: 0.1 };
    monitor.update(partial, signals);
    expect(monitor.getState().fullBody.health).toBe("lost");

    const point = body(5000);
    point.landmarks = point.landmarks.map((l) => ({ ...l, x: 0.5, y: 0.5 }));
    monitor.update(point, signals);
    expect(monitor.getState().bodyScale.health).toBe("lost");
  });

  it("degrades during a brief loss, goes lost after the grace period and recovers", () => {
    const monitor = new CalibrationMonitor(1000, 0.5);
    monitor.update(body(0), signals);
    monitor.update(null, { ...signals, nowMs: 500 });
    expect(monitor.getState().fullBody.health).toBe("degraded");
    expect(monitor.bodyReady()).toBe(true);
    monitor.update(null, { ...signals, nowMs: 1600 });
    expect(monitor.getState().fullBody.health).toBe("lost");
    expect(monitor.getState().bodyScale.health).toBe("lost");
    monitor.update(body(2000), signals);
    expect(monitor.getState().fullBody.health).toBe("valid");
  });
});
