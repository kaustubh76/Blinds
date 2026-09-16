import { render } from "@testing-library/react";
import { LoanStatus } from "@thewindow/solana-sdk";
import { describe, expect, it } from "vitest";
import { LifecycleTrack, stopFor } from "./LifecycleTrack";

describe("LifecycleTrack", () => {
  it("maps statuses to stops and terminals", () => {
    expect(stopFor(LoanStatus.Pending)).toEqual({ index: 0, terminal: null });
    expect(stopFor(LoanStatus.Locked)).toEqual({ index: 3, terminal: null });
    expect(stopFor(LoanStatus.Repaid)).toEqual({ index: 5, terminal: "repaid" });
    expect(stopFor(LoanStatus.Defaulted)).toEqual({ index: 5, terminal: "defaulted" });
  });

  it("marks the current stop and leaves later ones to do", () => {
    const { container } = render(<LifecycleTrack status={LoanStatus.Locked} />);
    const states = Array.from(container.querySelectorAll("li")).map((li) => li.getAttribute("data-state"));
    expect(states).toEqual(["done", "done", "done", "current", "todo", "todo"]);
  });

  it("a defaulted loan shows the terminal with its label, never colour alone", () => {
    const { container } = render(<LifecycleTrack status={LoanStatus.Defaulted} />);
    expect(container.textContent).toMatch(/defaulted/i);
    expect(container.querySelector("li:last-child svg")).not.toBeNull();
  });
});
