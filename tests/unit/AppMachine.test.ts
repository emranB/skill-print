import { describe, expect, it } from "vitest";
import { canTransition, transition } from "../../src/frontend/app/AppMachine";

describe("AppMachine", () => {
  it("allows HOME to TEACH_CALIBRATION and LEARN_LIBRARY", () => {
    expect(canTransition("HOME", "TEACH_CALIBRATION")).toBe(true);
    expect(canTransition("HOME", "LEARN_LIBRARY")).toBe(true);
    expect(canTransition("HOME", "TEACH_EDITING")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransition("HOME", "LEARN_ACTIVE")).toBe(false);
    expect(transition("HOME", "LEARN_ACTIVE")).toBe("HOME");
  });
});
