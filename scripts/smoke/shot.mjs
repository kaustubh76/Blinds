// usage: node shot.mjs <url> <out.png> [waitMs] [js-to-eval]
import { launch, wait } from "./browser.mjs";

const [url, out, waitMs = "8000", evalJs] = process.argv.slice(2);
const b = await launch();
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
p.on("console", (m) => {
  if (m.type() === "error") console.log("[error]", m.text().slice(0, 200));
});
await p.goto(url, { waitUntil: "networkidle2", timeout: 90_000 });
await wait(Number(waitMs));
if (evalJs) console.log("EVAL:", await p.evaluate(evalJs));
if (out) await p.screenshot({ path: out, fullPage: true });
await b.close();
