// One launcher for every driver: Chrome for Testing from puppeteer's cache (or PUPPETEER_EXECUTABLE_PATH),
// RESOLVE="host ip[, host ip]" maps fresh tunnel names past a stale local resolver, PROFILE keeps a burner.
import { existsSync, readdirSync } from "node:fs";
import puppeteer from "puppeteer-core";

function chrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const cache = `${process.env.HOME}/.cache/puppeteer/chrome`;
  const dirs = existsSync(cache)
    ? readdirSync(cache)
        .filter((d) => d.startsWith("mac_arm-") || d.startsWith("mac-") || d.startsWith("linux-"))
        .sort()
    : [];
  const d = dirs.at(-1);
  if (!d)
    throw new Error("no Chrome for Testing in ~/.cache/puppeteer — run: npx @puppeteer/browsers install chrome@stable");
  if (d.startsWith("linux")) return `${cache}/${d}/chrome-linux64/chrome`;
  return `${cache}/${d}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`;
}

export async function launch(extra = {}) {
  return puppeteer.launch({
    executablePath: chrome(),
    headless: true,
    protocolTimeout: 900_000,
    args: [
      "--no-sandbox",
      "--window-size=1400,1000",
      ...(process.env.RESOLVE ? [`--host-resolver-rules=MAP ${process.env.RESOLVE}`] : []),
    ],
    ...(process.env.PROFILE ? { userDataDir: process.env.PROFILE } : {}),
    ...extra,
  });
}

export const wait = (ms) => new Promise((r) => setTimeout(r, ms));
export const findButton = (page, text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(t));
    return b ? { disabled: b.disabled, title: b.title } : null;
  }, text);
export const clickButton = (page, text) =>
  page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.includes(t));
    if (!b || b.disabled) return false;
    b.click();
    return true;
  }, text);
export const bigintSafe = (_, v) => (typeof v === "bigint" ? `${v}n` : v);
