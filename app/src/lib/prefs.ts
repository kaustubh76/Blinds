/** Per-browser boolean preferences (console open, real-time on). Never anything secret. */
export function readPref(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(`thewindow:pref:${key}`);
    return v === null ? dflt : v === "1";
  } catch {
    return dflt;
  }
}

export function writePref(key: string, value: boolean): void {
  try {
    localStorage.setItem(`thewindow:pref:${key}`, value ? "1" : "0");
  } catch {
    // storage unavailable: the preference lives for this page load only
  }
}
