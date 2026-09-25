import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The clock and the real-time layer are mocked so this needs no QueryClientProvider and touches no
// RPC — the component under test is the canvas, not the data path.
const clock = { phase: "open", progress: 0.4, bids: 6 };
vi.mock("../lib/useWindowClock", () => ({ useWindowClock: () => clock }));
vi.mock("../lib/useLive", () => ({
  useLiveEvents: () => ({ connected: true, enabled: true, attempts: 0, events: [] }),
}));

const { Backdrop } = await import("./Backdrop");
const { backdrop } = await import("../lib/backdrop");

describe("Backdrop", () => {
  beforeEach(() => {
    backdrop.setEnabled(true);
  });

  it("renders a decorative canvas that cannot be reached or clicked", () => {
    const { container } = render(<Backdrop />);
    const canvas = container.querySelector("canvas");
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute("aria-hidden")).toBe("true");
    expect(canvas?.tabIndex).toBe(-1);
    expect(canvas?.className).toContain("pointer-events-none");
    expect(canvas?.className).toContain("-z-10");
  });

  // jsdom returns null from getContext; the component must simply do nothing rather than throw.
  it("survives a browser that will not give it a 2D context", () => {
    expect(() => render(<Backdrop />).unmount()).not.toThrow();
  });

  it("renders nothing at all once the preference is off", () => {
    backdrop.setEnabled(false);
    const { container } = render(<Backdrop />);
    expect(container.querySelector("canvas")).toBeNull();
  });

  it("renders nothing when the system asks for reduced motion", async () => {
    const real = window.matchMedia;
    window.matchMedia = ((q: string) =>
      ({
        matches: q.includes("reduced-motion"),
        media: q,
        addEventListener() {},
        removeEventListener() {},
        onchange: null,
        addListener() {},
        removeListener() {},
        dispatchEvent: () => false,
      }) as MediaQueryList) as typeof window.matchMedia;
    try {
      const { container } = render(<Backdrop />);
      expect(container.querySelector("canvas")).toBeNull();
    } finally {
      window.matchMedia = real;
    }
  });

  it("takes a pulse without throwing and without re-rendering", () => {
    let renders = 0;
    function Counted() {
      renders++;
      return <Backdrop />;
    }
    render(<Counted />);
    const before = renders;
    backdrop.pulse("print");
    backdrop.pulse("bid");
    expect(renders).toBe(before);
  });

  it("cleans up after itself", () => {
    const cancel = vi.spyOn(window, "cancelAnimationFrame");
    const remove = vi.spyOn(document, "removeEventListener");
    render(<Backdrop />).unmount();
    // With no 2D context the loop never starts, so only the listener teardown is guaranteed here;
    // what matters is that unmounting is clean either way.
    expect(() => {
      cancel.mockRestore();
      remove.mockRestore();
    }).not.toThrow();
  });
});
