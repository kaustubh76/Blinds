import { describe, expect, it } from "vitest";
import { slotsToClock } from "./Countdown";

describe("slotsToClock", () => {
  it("renders slots as mm:ss at ~0.45 s per slot, hours when needed", () => {
    expect(slotsToClock(0)).toBe("0:00");
    expect(slotsToClock(133)).toBe("1:00");
    expect(slotsToClock(900)).toBe("6:45");
    expect(slotsToClock(8000)).toBe("1:00:00");
    expect(slotsToClock(-5)).toBe("0:00");
  });
});
