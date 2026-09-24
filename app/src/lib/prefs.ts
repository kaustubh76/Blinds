/** Per-browser boolean preferences (console open, real-time on, background motion). Never anything secret. */
const PREFIX = "thewindow:pref:";

export function readPref(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(`${PREFIX}${key}`);
    return v === null ? dflt : v === "1";
  } catch {
    return dflt;
  }
}

export function writePref(key: string, value: boolean): void {
  try {
    localStorage.setItem(`${PREFIX}${key}`, value ? "1" : "0");
  } catch {
    // storage unavailable: the preference lives for this page load only
  }
}

/** Forgets every preference in this namespace. "Reset to defaults" means all of them. */
export function clearPrefs(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(PREFIX)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    // storage unavailable: there was nothing persisted to forget
  }
}
