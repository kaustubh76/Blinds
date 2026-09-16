import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EncryptedValue, sealPattern } from "./EncryptedValue";

const bytes = Uint8Array.from({ length: 64 }, (_, i) => (i * 37 + 11) & 0xff);

describe("EncryptedValue — the only ciphertext→screen path", () => {
  it("renders a sealed chip and no number when no plaintext is given", () => {
    const { container } = render(<EncryptedValue bytes={bytes} label="size" />);
    const text = container.textContent ?? "";
    expect(text).toContain("size");
    expect(text).not.toMatch(/\d{2,}[.,]\d/); // no formatted amount
    expect(screen.queryByText(/decrypted in this tab/i)).toBeNull();
    expect(container.querySelector("[data-sealed='true']")).not.toBeNull();
  });

  it("treats null and undefined plaintext as sealed", () => {
    const a = render(<EncryptedValue bytes={bytes} plaintext={null} />);
    expect(a.container.querySelector("[data-sealed='true']")).not.toBeNull();
    a.unmount();
    const b = render(<EncryptedValue bytes={bytes} plaintext={undefined} />);
    expect(b.container.querySelector("[data-sealed='true']")).not.toBeNull();
  });

  it("opens only with a plaintext handed in, and says where it was decrypted", () => {
    render(<EncryptedValue bytes={bytes} plaintext="1,000.000" />);
    expect(screen.getByText("1,000.000")).toBeTruthy();
    expect(screen.getByText(/decrypted in this tab/i)).toBeTruthy();
  });

  it("the seal pattern is a stable fingerprint of the bytes", () => {
    expect(sealPattern(bytes)).toBe(sealPattern(Uint8Array.from(bytes)));
    const other = Uint8Array.from(bytes);
    other[0] = (other[0] ?? 0) ^ 0xff;
    expect(sealPattern(other)).not.toBe(sealPattern(bytes));
  });
});
