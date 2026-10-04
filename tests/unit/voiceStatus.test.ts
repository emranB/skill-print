import { describe, expect, it } from "vitest";
import { voiceStatus } from "../../src/frontend/apprentice/voiceStatus";

describe("voice status", () => {
  it("maps SDK state to the six user-facing statuses", () => {
    expect(voiceStatus("disconnected", false, false, false)).toBe("Disconnected");
    expect(voiceStatus("disconnecting", false, false, true)).toBe("Disconnected");
    expect(voiceStatus("connecting", false, false, false)).toBe("Connecting");
    expect(voiceStatus("connected", false, false, false)).toBe("Connected");
    expect(voiceStatus("connected", false, false, true)).toBe("Listening");
    expect(voiceStatus("connected", true, false, true)).toBe("Speaking");
    expect(voiceStatus("connected", true, true, true)).toBe("Error");
  });
});
