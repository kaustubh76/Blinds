/** `#/explorer/16` — tabs and one optional parameter, linkable and back-button friendly. */
import { useCallback, useEffect, useState } from "react";

export const TABS = ["home", "desk", "positions", "market", "agent", "explorer", "build"] as const;
export type Tab = (typeof TABS)[number];

export interface Route {
  tab: Tab;
  param?: string;
}

export function parseHash(hash: string): Route {
  // `#/market?theme=dark` is still the Market: a query inside the hash is not part of the route.
  const [tab = "home", param] = (hash.replace(/^#\/?/, "").split("?")[0] ?? "").split("/");
  const t = (TABS as readonly string[]).includes(tab) ? (tab as Tab) : "home";
  return param ? { tab: t, param } : { tab: t };
}

export function toHash(tab: Tab, param?: string): string {
  return `#/${tab}${param ? `/${param}` : ""}`;
}

export function useHashRoute() {
  const [route, setRoute] = useState<Route>(() =>
    typeof window === "undefined" ? { tab: "home" } : parseHash(window.location.hash),
  );
  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const go = useCallback((tab: Tab, param?: string) => {
    window.location.hash = toHash(tab, param);
  }, []);
  return { ...route, go };
}
