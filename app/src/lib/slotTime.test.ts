import { describe, expect, it } from "vitest";
import { formatSlotAge } from "./format";
import { SLOT_SECONDS_DEFAULT, secsToSlots, setSlotSeconds, slotSeconds, slotsToSecs } from "./slotTime";

describe("seconds per slot is measured, not assumed", () => {
  it("starts at the historical default and follows the measurement within plausible bounds", () => {
    expect(slotSeconds()).toBe(SLOT_SECONDS_DEFAULT);
    setSlotSeconds(0.17); // devnet from 22 Sep 2026
    expect(slotSeconds()).toBe(0.17);
    expect(slotsToSecs(1200)).toBe(204); // max_price_age_slots = 1200 → 3.4 min, not 9
    expect(formatSlotAge(1200)).toBe("3 min");
    expect(Math.round(secsToSlots(3600))).toBe(21176);
    setSlotSeconds(0.01);
    expect(slotSeconds()).toBe(0.1); // clamped: no cluster runs that fast
    setSlotSeconds(5);
    expect(slotSeconds()).toBe(1);
    setSlotSeconds(SLOT_SECONDS_DEFAULT);
  });
});
