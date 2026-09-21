// The judge's path: fresh burner → Autopilot (derive, join, set up, wrap, sealed borrow bid).
// usage: PROFILE=<dir> node demo.mjs <site url with ?admin=> [listingKey]
import { clickButton, findButton, launch, wait } from "./browser.mjs";

const [site, listingKey = "prestocks_anthropic"] = process.argv.slice(2);
const b = await launch();
const page = await b.newPage();
await page.setViewport({ width: 1400, height: 1000 });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
const base = site.replace(/#.*$/, "");
await page.goto(base, { waitUntil: "networkidle2", timeout: 90_000 });
await page.evaluate((k) => localStorage.setItem("thewindow:listing", k), listingKey);
await page.goto(`${base}#/desk`, { waitUntil: "networkidle2", timeout: 90_000 });
await page.reload({ waitUntil: "networkidle2" });
await wait(5000);
if (await findButton(page, "devnet burner")) {
  await clickButton(page, "devnet burner");
  await wait(5000);
}
for (let i = 0; i < 30; i++) {
  const r = await findButton(page, "Run it");
  if (r && !r.disabled) break;
  await wait(2000);
}
const before = await page.evaluate(() => ({
  faucet: document.body.innerText.includes("faucet offline") ? "offline" : "ok",
}));
console.log("before:", JSON.stringify(before));
if (!(await clickButton(page, "Run it"))) {
  console.log("Run it disabled:", JSON.stringify(await findButton(page, "Run it")));
  await b.close();
  process.exit(1);
}
const started = Date.now();
let done = null;
for (let i = 0; i < 400 && !done; i++) {
  await wait(3000);
  done = await page.evaluate(() => {
    const c = window.thewindow.console.getSnapshot();
    const bid = c.filter((e) => e.kind === "call" && e.title.startsWith("buildBidPlan")).pop();
    const failed = c.filter((e) => e.kind === "call" && e.state === "failed").pop();
    return bid && (bid.state === "confirmed" || bid.state === "failed")
      ? bid.state
      : failed
        ? `failed:${failed.title} ${failed.error}`
        : null;
  });
}
const entries = await page.evaluate(() =>
  window.thewindow.console
    .getSnapshot()
    .filter((e) => e.kind !== "chain")
    .map(
      (e) =>
        e.title +
        (e.state ? ` [${e.state}]` : "") +
        (e.signature ? ` ${e.signature}` : "") +
        (e.error ? ` !! ${e.error}` : ""),
    ),
);
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: true });
console.log(JSON.stringify({ done, secs: Math.round((Date.now() - started) / 1000), entries, errors }, null, 1));
await b.close();
process.exit(done === "confirmed" ? 0 : 1);
