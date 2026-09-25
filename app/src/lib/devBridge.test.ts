import { describe, expect, it } from "vitest";
// The dev-server plugin. It is not part of a build, which is exactly why the page carries its own
// copy of the command text — and why this test exists.
import { COMMANDS, commandLines, scrub, validate } from "../../vite/devBridge.mjs";
import { COMMAND_TEXT } from "./devBridge";

describe("the dev bridge's command table", () => {
  it("has one entry in the page's copy for every command the plugin will run", () => {
    expect(Object.keys(COMMAND_TEXT).sort()).toEqual(COMMANDS.map((c) => c.id).sort());
  });

  it("agrees with the plugin on the label, the blurb, the command line and what it spends", () => {
    const lines = commandLines();
    for (const [id, want] of Object.entries(lines)) {
      expect(COMMAND_TEXT[id], `${id} is missing from the page's copy`).toEqual(want);
    }
  });

  it("names a spending cluster only from the three that exist", () => {
    for (const c of Object.values(COMMAND_TEXT))
      if (c.spends) expect(["localnet", "devnet", "mainnet"]).toContain(c.spends);
  });
});

describe("scrub", () => {
  it("removes a Clawpump key, a 64-hex seed and a keypair path", () => {
    const out = scrub(
      "key cpk_ABCDEFGH1234 seed e43662aabbccddeeff00112233445566778899aabbccddeeff00112233445566 at /Users/x/.config/solana/id.json",
    );
    expect(out).not.toContain("cpk_ABCDEFGH1234");
    expect(out).not.toContain("e43662");
    expect(out).not.toContain(".config/solana");
  });

  it("removes a named secret wherever it appears", () => {
    expect(scrub("token=supersecretvalue ok", ["supersecretvalue"])).toBe("token=«redacted» ok");
  });

  it("ignores a secret too short to be one, rather than redacting everything", () => {
    expect(scrub("a b c", ["ab"])).toBe("a b c");
  });

  it("leaves ordinary output alone", () => {
    const line = "[TSLAx-mock] price 40079620280 expo -8 (400.79 USD) age 0 s";
    expect(scrub(line)).toBe(line);
  });
});

describe("validate", () => {
  const intCmd = { params: { amount: { kind: "int" as const, min: 1, max: 10, default: 5 } } };
  const choiceCmd = {
    params: { cluster: { kind: "choice" as const, choices: ["localnet", "devnet"], default: "localnet" } },
  };

  it("falls back to the default when nothing is given", () => {
    expect(validate(intCmd, undefined).values).toEqual({ amount: 5 });
    expect(validate(choiceCmd, {}).values).toEqual({ cluster: "localnet" });
  });

  it("accepts a value inside the range and refuses one outside it", () => {
    expect(validate(intCmd, { amount: 7 }).values).toEqual({ amount: 7 });
    expect(validate(intCmd, { amount: 0 }).error).toMatch(/between 1 and 10/);
    expect(validate(intCmd, { amount: 11 }).error).toMatch(/between 1 and 10/);
    expect(validate(intCmd, { amount: 1.5 }).error).toMatch(/whole number/);
    expect(validate(intCmd, { amount: "seven" }).error).toMatch(/whole number/);
  });

  it("refuses a choice that is not on the list — including a cluster we will not touch", () => {
    expect(validate(choiceCmd, { cluster: "mainnet" }).error).toMatch(/localnet, devnet/);
    expect(validate(choiceCmd, { cluster: "; rm -rf /" }).error).toBeTruthy();
  });

  it("takes nothing from the request for a command with no parameters", () => {
    expect(validate({}, { rogue: "value" }).values).toEqual({});
  });
});
