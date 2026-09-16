import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stepper } from "./Stepper";

describe("Stepper", () => {
  it("a blocked step says why and offers nothing to click", () => {
    render(
      <Stepper
        steps={[
          { title: "Derive keys", state: "done", action: <button type="button">re-derive</button> },
          {
            title: "Join",
            state: "blocked",
            detail: "the faucet is not reachable",
            action: <button type="button">Join</button>,
          },
        ]}
      />,
    );
    expect(screen.getByText("the faucet is not reachable")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
    expect(screen.getByRole("button", { name: "re-derive" })).toBeTruthy();
  });
});
