// After the print: on Positions, derive inline, "Prove solvency & lock", "Transfer collateral to escrow".
// usage: PROFILE=<same dir as demo.mjs> WAIT_MS=<ms> node positions.mjs <site url with ?admin=>
import { clickButton, findButton, launch, wait } from "./browser.mjs";

const [site] = process.argv.slice(2);
const b = await launch();
const page = await b.newPage();
await page.setViewport({ width: 1400, height: 1000 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
await page.goto(`${site.replace(/#.*$/, "")}#/positions`, { waitUntil: "networkidle2", timeout: 90_000 });
await wait(6000);
const derive = async () => {
  if (await findButton(page, "Sign to derive")) {
    await clickButton(page, "Sign to derive");
    await wait(4000);
  }
};
await derive();
const deadline = Date.now() + Number(process.env.WAIT_MS ?? 900_000);
let phase = "waiting for a matched loan";
while (Date.now() < deadline) {
  const btn = await findButton(page, "Prove solvency");
  if (btn && !btn.disabled) {
    phase = "lock";
    break;
  }
  // A loan already locked in an earlier run (its deposit was interrupted): only the transfer is left.
  const t = await findButton(page, "Transfer collateral");
  if (t && !t.disabled) {
    phase = "deposit";
    break;
  }
  await wait(10_000);
  await page.reload({ waitUntil: "networkidle2" });
  await wait(4000);
  await derive();
}
const waitCall = async (prefix) => {
  for (let i = 0; i < 200; i++) {
    await wait(3000);
    const s = await page.evaluate((p) => {
      const c = window.thewindow.console
        .getSnapshot()
        .filter((e) => e.kind === "call" && e.title.startsWith(p))
        .pop();
      return c && (c.state === "confirmed" || c.state === "failed")
        ? c.state + (c.error ? ` !! ${c.error}` : "")
        : null;
    }, prefix);
    if (s) return s;
  }
  return "timeout";
};
let lock = null,
  deposit = null;
if (phase === "lock") {
  await clickButton(page, "Prove solvency");
  lock = await waitCall("buildLockPlan");
  if (lock === "confirmed") {
    for (let i = 0; i < 20; i++) {
      await wait(3000);
      const t = await findButton(page, "Transfer collateral");
      if (t && !t.disabled) break;
    }
    await clickButton(page, "Transfer collateral");
    deposit = await waitCall("buildDepositPlan");
  }
} else if (phase === "deposit") {
  lock = "confirmed (earlier)";
  await clickButton(page, "Transfer collateral");
  deposit = await waitCall("buildDepositPlan");
}
const log = await page.evaluate(() =>
  window.thewindow.console
    .getSnapshot()
    .filter((e) => e.kind === "call" || e.kind === "tx")
    .map(
      (e) =>
        e.title +
        (e.state ? ` [${e.state}]` : "") +
        (e.signature ? ` ${e.signature}` : "") +
        (e.error ? ` !! ${e.error}` : ""),
    ),
);
const text = await page.evaluate(() => document.body.innerText.slice(0, 900).replace(/\n/g, " | "));
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
console.log(JSON.stringify({ phase, lock, deposit, text, log, errors }, null, 1));
await b.close();
process.exit(lock?.startsWith("confirmed") && deposit === "confirmed" ? 0 : 1);
