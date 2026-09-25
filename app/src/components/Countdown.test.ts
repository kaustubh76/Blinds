import { describe, expect, it } from "vitest";
import { SLOT_SECONDS_DEFAULT } from "../lib/slotTime";
import { slotsToClock } from "./Countdown";

/** mm:ss at the rate in force, so this test does not pin the cluster's pace. */
const clock = (slots: number) => {
  const secs = Math.max(0, Math.round(slots * SLOT_SECONDS_DEFAULT));
  const [h, m, s] = [Math.floor(secs / 3600), Math.floor((secs % 3600) / 60), secs % 60];
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

describe("slotsToClock", () => {
  it("renders slots as mm:ss at the measured pace, hours when needed", () => {
    expect(slotsToClock(0)).toBe("0:00");
    expect(slotsToClock(133)).toBe(clock(133));
    expect(slotsToClock(900)).toBe(clock(900));
    expect(slotsToClock(Math.ceil(3600 / SLOT_SECONDS_DEFAULT))).toMatch(/^1:00:0[01]$/);
    expect(slotsToClock(-5)).toBe("0:00");
  });
});
