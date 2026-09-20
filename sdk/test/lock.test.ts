import { describe, expect, it } from "vitest";
import { describeTxError, isDeltaMismatch } from "../src/index.js";

describe("DeltaMismatch detection", () => {
  it("matches the simulation form, the confirmed form (with bigints) and the Anchor name", () => {
    expect(isDeltaMismatch(new Error("custom program error: 0x1786"))).toBe(true);
    expect(isDeltaMismatch(new Error("Program log: AnchorError … Error Code: DeltaMismatch. Error Number: 6022"))).toBe(
      true,
    );
    const confirmed = { InstructionError: [0n, { Custom: 6022 }] };
    expect(describeTxError(confirmed)).toBe('{"InstructionError":[0,{"Custom":6022}]}');
    expect(isDeltaMismatch(new Error(`transaction X failed: ${describeTxError(confirmed)}`))).toBe(true);
    expect(isDeltaMismatch(new Error("custom program error: 0x1"))).toBe(false);
  });
});
