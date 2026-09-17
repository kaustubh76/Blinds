import { getBase64Decoder } from "@solana/kit";
import { auction, oracle } from "@thewindow/solana-sdk";
import { describe, expect, it } from "vitest";
import { decodeProgramDataLogs, EVENT_TABLE } from "./live";

const dataLine = (bytes: Uint8Array) => `Program data: ${getBase64Decoder().decode(bytes)}`;

describe("program events over logs", () => {
  it("knows every event the five programs declare", () => {
    const names = EVENT_TABLE.map((d) => `${d.program}.${d.name}`);
    expect(names).toEqual(
      expect.arrayContaining([
        "auction.EpochOpened",
        "auction.EpochClosed",
        "auction.BidSubmitted",
        "auction.EpochPrinted",
        "oracle.Printed",
        "oracle.NoTrade",
        "credit.MatchPosted",
        "credit.LoanStatusChanged",
        "registry.MemberAdded",
        "wrap.Wrapped",
      ]),
    );
    expect(names.length).toBeGreaterThanOrEqual(20);
    expect(new Set(EVENT_TABLE.map((d) => Array.from(d.disc).join(","))).size).toBe(EVENT_TABLE.length);
  });

  it("decodes Anchor 'Program data' lines with the generated codecs and skips the rest", () => {
    const printed = new Uint8Array(
      oracle
        .getPrintedEventEncoder()
        .encode({ epoch: 31n, rStarTick: 8, rStarBps: 300, matchedVolume: 322_000_000n, stale: false, tau: 3 }),
    );
    const opened = new Uint8Array(auction.getEpochOpenedEventEncoder().encode({ index: 32n, startSlot: 1234n }));
    const logs = [
      "Program HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6 invoke [1]",
      dataLine(opened),
      "Program data: AAAAAAAAAAA=", // 8 zero bytes: no such discriminator
      "Program data: not-base64!!",
      dataLine(printed),
      "Program HGToTRudawYs9WXSxQdi854A7PiEfUeiNi5GDSXfXQb6 success",
    ];
    const out = decodeProgramDataLogs(logs);
    expect(out.map((e) => `${e.program}.${e.name}`)).toEqual(["auction.EpochOpened", "oracle.Printed"]);
    expect(out[0]?.data).toEqual({ index: 32n, startSlot: 1234n });
    expect(out[1]?.data).toMatchObject({ epoch: 31n, rStarTick: 8, matchedVolume: 322_000_000n });
  });
});
