// Runs the Build page's wallet-free recipes and prints each result. usage: node recipes.mjs <url#/build> [ids,comma]
import { bigintSafe, launch } from "./browser.mjs";

const [url = "https://kaustubh76.github.io/Blinds/#/build", idsArg] = process.argv.slice(2);
const ids = (idsArg ?? "config,schedule,pyth-mainnet,marks,solvency,latest-print,verify,subscribe").split(",");
const b = await launch();
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
const errors = [];
p.on("pageerror", (e) => errors.push(String(e).slice(0, 200)));
await p.goto(url, { waitUntil: "networkidle2", timeout: 90_000 });
await p.waitForFunction(() => !!window.thewindow, { timeout: 60_000 });
const out = {};
for (const id of ids) {
  const t0 = Date.now();
  const clicked = await p.evaluate((id) => {
    const card = document.querySelector(`[data-recipe="${id}"]`);
    const btn = card && [...card.querySelectorAll("button")].find((x) => /run here/i.test(x.textContent));
    if (!btn) return { ok: false, reason: `no card/button for ${id}` };
    if (btn.disabled) return { ok: false, reason: `disabled: ${btn.title}` };
    btn.click();
    return { ok: true };
  }, id);
  if (!clicked.ok) {
    out[id] = clicked.reason;
    continue;
  }
  out[id] = await p
    .waitForFunction(
      (since) => {
        const es = window.thewindow.console
          .getSnapshot()
          .filter((e) => e.kind === "call" && e.at >= since && (e.title || "").startsWith("recipe:"));
        const e = es[es.length - 1];
        return e && (e.state === "confirmed" || e.state === "failed")
          ? JSON.stringify({ state: e.state, ms: Date.now() - e.at, detail: e.detail ?? e.error ?? null }, (_, v) =>
              typeof v === "bigint" ? `${v}n` : v,
            )
          : false;
      },
      { timeout: 150_000, polling: 500 },
      t0 - 1,
    )
    .then((h) => h.jsonValue().then(JSON.parse))
    .catch(() => ({ state: "timeout" }));
}
console.log(JSON.stringify({ out, errors }, bigintSafe, 1));
await b.close();
process.exit(Object.values(out).every((v) => v?.state === "confirmed") ? 0 : 1);
