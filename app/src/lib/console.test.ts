import { describe, expect, it } from "vitest";
import { CONSOLE_CAPACITY, devConsole, jsonSafe } from "./console";

describe("dev console store", () => {
  it("keeps the newest entries within capacity and updates in place", () => {
    devConsole.clear();
    for (let i = 0; i < CONSOLE_CAPACITY + 5; i++) devConsole.push({ kind: "note", title: `n${i}` });
    const snap = devConsole.getSnapshot();
    expect(snap).toHaveLength(CONSOLE_CAPACITY);
    expect(snap[0]?.title).toBe("n5");
    expect(snap.at(-1)?.title).toBe(`n${CONSOLE_CAPACITY + 4}`);
    const id = devConsole.push({ kind: "tx", title: "t", state: "pending" });
    devConsole.update(id, { state: "confirmed", signature: "abc" });
    const e = devConsole.getSnapshot().find((x) => x.id === id);
    expect(e?.state).toBe("confirmed");
    expect(e?.signature).toBe("abc");
  });

  it("notifies subscribers and hands out stable snapshots", () => {
    devConsole.clear();
    let n = 0;
    const off = devConsole.subscribe(() => n++);
    const a = devConsole.getSnapshot();
    expect(devConsole.getSnapshot()).toBe(a);
    devConsole.push({ kind: "chain", title: "epoch 1 → open" });
    expect(n).toBe(1);
    expect(devConsole.getSnapshot()).not.toBe(a);
    off();
    devConsole.push({ kind: "chain", title: "epoch 1 → closed" });
    expect(n).toBe(1);
  });

  it("serialises bigint and bytes for the clipboard", () => {
    expect(JSON.parse(jsonSafe({ a: 5n, b: new Uint8Array([1, 255]) }))).toEqual({ a: "5n", b: "0x01ff" });
  });
});
