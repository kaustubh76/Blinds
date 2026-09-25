import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BURNER_STORAGE_KEY } from "../lib/burner";
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
    fireEvent.click(screen.getByText(/Clear saved settings and reload/));
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
  it("keeps the two things that cannot be regenerated", () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const addr = "6UrytPKNq1qVsGvZ1dEoSdBqk7qNnQpQxMeF8aUfGHiJ";
    localStorage.setItem(BURNER_STORAGE_KEY, JSON.stringify({ sk: "ab".repeat(32), address: addr }));
    localStorage.setItem(`thewindow:bids:${addr}`, JSON.stringify([{ epoch: "1", opening: "cd" }]));
    localStorage.setItem("thewindow:pref:live", "0");
    Object.defineProperty(window, "location", { value: { reload: vi.fn() }, writable: true });
    render(
      <ErrorScreen>
        <Boom />
      </ErrorScreen>,
    );
    fireEvent.click(screen.getByText(/Clear saved settings and reload/));
    expect(localStorage.getItem(BURNER_STORAGE_KEY)).toBeTruthy(); // the wallet holding the position
    expect(localStorage.getItem(`thewindow:bids:${addr}`)).toBeTruthy(); // the openings a lock proof needs
    expect(localStorage.getItem("thewindow:pref:live")).toBeNull(); // a preference is regenerable
    quiet.mockRestore();
  });

  it("offers to save the key and the openings before they can be forgotten", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const addr = "6UrytPKNq1qVsGvZ1dEoSdBqk7qNnQpQxMeF8aUfGHiJ";
    localStorage.setItem(BURNER_STORAGE_KEY, JSON.stringify({ sk: "ab".repeat(32), address: addr }));
    localStorage.setItem(
      `thewindow:bids:${addr}`,
      JSON.stringify([{ epoch: "1", side: 0, tick: 12, sizeMicroUsdc: "1", opening: "cd", ciphertext: "ef", at: 1 }]),
    );
    let saved: Blob | null = null;
    URL.createObjectURL = vi.fn((b: Blob | MediaSource) => {
      saved = b as Blob;
      return "blob:session";
    });
    URL.revokeObjectURL = vi.fn();
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    render(
      <ErrorScreen>
        <Boom />
      </ErrorScreen>,
    );
    fireEvent.click(screen.getByText(/Save them to a file/));
    expect(clicked).toHaveBeenCalled();
    const doc = JSON.parse(await (saved as unknown as Blob).text());
    expect(doc.address).toBe(addr);
    expect(doc.secretHex).toBe("ab".repeat(32));
    expect(doc.bids).toHaveLength(1);
    expect(screen.getByText(/saved the key and 1 bid record/)).toBeTruthy();
    clicked.mockRestore();
    quiet.mockRestore();
  });
});
