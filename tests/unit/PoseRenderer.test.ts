import { expect, it, vi } from "vitest";
import { drawSkeleton } from "../../src/frontend/pose/PoseRenderer";
import { MAJOR_JOINTS } from "../../src/frontend/pose/PoseUsability";

it("does not draw untracked ghost head/extremities at the canvas origin", () => {
  const landmarks = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0, visibility: 0 }));
  for (const index of MAJOR_JOINTS) landmarks[index] = { x: .4, y: .5, z: 0, visibility: 1 };
  const context = { save: vi.fn(), restore: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(), arc: vi.fn(), fill: vi.fn() };
  drawSkeleton(context as unknown as CanvasRenderingContext2D, landmarks, 640, 360, { color: "#ffb547", floor: .5 });
  expect(context.stroke).toHaveBeenCalled();
  expect([...context.moveTo.mock.calls, ...context.lineTo.mock.calls, ...context.arc.mock.calls]
    .every(([x, y]) => x !== 0 && y !== 0)).toBe(true);
});
