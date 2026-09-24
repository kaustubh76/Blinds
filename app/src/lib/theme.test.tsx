import { beforeEach, describe, expect, it } from "vitest";
import { resolvedTheme, setTheme, THEME_KEY } from "./theme";

/** jsdom gives us a real location and localStorage; the URL is what this behaviour turns on. */
function load(search: string) {
  window.history.replaceState(null, "", `/${search}`);
  localStorage.clear();
}

describe("theme", () => {
  beforeEach(() => {
    load("");
  });

  it("lets a ?theme= link decide the page load", () => {
    load("?theme=dark");
    expect(resolvedTheme()).toBe("dark");
  });

  // The header toggle used to have no effect on a `?theme=` link: it wrote localStorage, which the
  // URL then outranked on every read, so the second press did nothing.
  it("hands control to the toggle once the visitor picks one", () => {
    load("?theme=dark");
    expect(resolvedTheme()).toBe("dark");
    setTheme("light");
    expect(resolvedTheme()).toBe("light");
    setTheme("dark");
    expect(resolvedTheme()).toBe("dark");
    setTheme("light");
    expect(resolvedTheme()).toBe("light");
  });

  it("remembers the choice for the next load", () => {
    setTheme("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
    setTheme("system");
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
  });
});
