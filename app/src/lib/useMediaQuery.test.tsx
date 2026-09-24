import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { BELOW_SM, useMediaQuery } from "./useMediaQuery";

const real = window.matchMedia;
afterEach(() => {
  window.matchMedia = real;
});

/** jsdom has no matchMedia of its own; `test/setup.ts` stubs a never-matching one. */
function stub(matches: (q: string) => boolean, onAdd?: () => void) {
  window.matchMedia = ((q: string) =>
    ({
      matches: matches(q),
      media: q,
      addEventListener: onAdd ?? (() => {}),
      removeEventListener() {},
      onchange: null,
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList) as typeof window.matchMedia;
}

describe("useMediaQuery", () => {
  it("reports a query that matches, and one that does not", () => {
    stub((q) => q === BELOW_SM);
    expect(renderHook(() => useMediaQuery(BELOW_SM)).result.current).toBe(true);
    expect(renderHook(() => useMediaQuery("(pointer: coarse)")).result.current).toBe(false);
  });

  it("subscribes so a change can re-render, and unsubscribes on unmount", () => {
    const added: string[] = [];
    stub(
      () => false,
      () => added.push("change"),
    );
    const { unmount } = renderHook(() => useMediaQuery(BELOW_SM));
    expect(added).toHaveLength(1);
    expect(() => unmount()).not.toThrow();
  });

  // The charts and the seventh tab ask this before a DOM exists in some environments; the caller
  // picks the safe side of its own question, which is why the default is a parameter.
  it("falls back to the caller's answer when there is no matchMedia at all", () => {
    window.matchMedia = undefined as unknown as typeof window.matchMedia;
    expect(renderHook(() => useMediaQuery(BELOW_SM)).result.current).toBe(false);
    expect(renderHook(() => useMediaQuery(BELOW_SM, true)).result.current).toBe(true);
  });
});
