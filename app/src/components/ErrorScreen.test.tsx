import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ErrorScreen } from "./ErrorScreen";

function Boom(): never {
  throw new Error("Intl broken by a browser extension");
}

describe("the crash screen", () => {
  it("prints what failed instead of leaving a blank page", () => {
    // React logs the caught error; the test asserts on what the visitor sees, not on that noise.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <ErrorScreen>
        <Boom />
      </ErrorScreen>,
    );
    expect(screen.getByText(/Something in this browser broke the page/)).toBeTruthy();
    expect(screen.getByText(/Intl broken by a browser extension/)).toBeTruthy();
    quiet.mockRestore();
  });

  it("offers the reset that fixes a poisoned browser, and keeps a healthy page untouched", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    localStorage.setItem("thewindow:settings", '{"rpcUrl":"http://unreachable"}');
    const reload = vi.fn();
    Object.defineProperty(window, "location", { value: { reload }, writable: true });
    render(
      <ErrorScreen>
        <Boom />
      </ErrorScreen>,
    );
    fireEvent.click(screen.getByText(/Clear this site's settings and reload/));
    expect(localStorage.getItem("thewindow:settings")).toBeNull();
    expect(reload).toHaveBeenCalled();
    quiet.mockRestore();

    const ok = render(
      <ErrorScreen>
        <p>the desk</p>
      </ErrorScreen>,
    );
    expect(ok.getByText("the desk")).toBeTruthy();
  });
});
