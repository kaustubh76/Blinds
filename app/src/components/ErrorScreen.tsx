/**
 * The last line of defence: a render that throws must never leave a blank page.
 *
 * Everything the dashboard shows is derived from chain reads and from browser state (saved RPC and
 * faucet settings, a burner key, wallet extensions that inject themselves into the page), so a
 * crash here is usually specific to one visitor's browser and invisible to everyone else. The
 * boundary prints what failed and offers the two things that fix a poisoned browser: clear this
 * site's saved settings, or reload.
 *
 * What it must never do is take the burner key and the bid book with them. The key *is* the wallet
 * holding the position, and the bid book holds each sealed bid's Pedersen opening — the only copy
 * anywhere, and what a lock proof needs. This screen's button is the obvious thing to press when the
 * page breaks, so it clears what can poison a render and nothing else.
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { clearSettings } from "../config";
import { BURNER_STORAGE_KEY } from "../lib/burner";
import { clearPrefs } from "../lib/prefs";

interface State {
  error: Error | null;
  info: string | null;
}

export class ErrorScreen extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Also on the console, where a visitor can copy it out of DevTools.
    console.error("dashboard crashed", error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  /**
   * Everything a render reads from storage, except the two things that cannot be regenerated: the
   * saved endpoints, the preferences, the theme and the selected listing (a listing this deployment
   * no longer carries has broken a render before). The burner key and every bid book stay.
   */
  private reset = (): void => {
    clearSettings();
    clearPrefs();
    try {
      for (const k of ["thewindow:theme", "thewindow:listing"]) localStorage.removeItem(k);
    } catch {
      // private window: nothing was saved anyway
    }
    location.reload();
  };

  /**
   * The escape hatch for the one poison the reset above deliberately leaves behind: a stored burner
   * whose own shape breaks the page. It names what it takes, the way the Settings sheet does.
   */
  private forgetEverything = (): void => {
    if (
      !confirm(
        "Forget the burner key and every bid record too? Anything the key holds stays with the key, and a sealed bid's opening cannot be recovered.",
      )
    )
      return;
    try {
      localStorage.clear();
    } catch {
      // private window: nothing was saved anyway
    }
    location.reload();
  };

  private hasKey = (): boolean => {
    try {
      return localStorage.getItem(BURNER_STORAGE_KEY) !== null;
    } catch {
      return false;
    }
  };

  override render(): ReactNode {
    const { error, info } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="mx-auto flex min-h-screen max-w-[720px] flex-col justify-center gap-5 px-6 py-12">
        <div>
          <div className="t-eyebrow">the dashboard stopped</div>
          <h1 className="t-h1 mt-2 text-ink-1">Something in this browser broke the page.</h1>
          <p className="t-lead mt-3">
            The chain is unaffected. Usually a saved endpoint that is unreachable, or a wallet extension.
          </p>
        </div>
        <pre className="mono overflow-x-auto rounded-[var(--radius-md)] border border-line bg-surface-2 p-4 text-xs text-status-critical">
          {error.message || String(error)}
        </pre>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={this.reset}
            className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-accent-ink"
          >
            Clear saved settings and reload
          </button>
          <button
            type="button"
            onClick={() => location.reload()}
            className="rounded-full border border-line px-4 py-2 text-sm text-ink-2"
          >
            Just reload
          </button>
        </div>
        <p className="text-xs text-ink-3">
          Your burner key and your bid records are kept.
          {this.hasKey() && (
            <>
              {" "}
              <button type="button" onClick={this.forgetEverything} className="underline hover:text-status-critical">
                Forget those too
              </button>{" "}
              only if the key itself is what broke the page.
            </>
          )}
        </p>
        {info && (
          <details className="text-xs text-ink-3">
            <summary className="cursor-pointer">where it happened</summary>
            <pre className="mono mt-2 overflow-x-auto whitespace-pre-wrap">{info}</pre>
          </details>
        )}
      </div>
    );
  }
}
