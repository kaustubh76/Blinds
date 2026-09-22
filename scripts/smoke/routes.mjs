// Every route of the hosted site: page errors, failed requests, stray "undefined"/"NaN".
// usage: node routes.mjs <site base url>
import { launch, wait } from "./browser.mjs";

const [base = "https://kaustubh76.github.io/Blinds/"] = process.argv.slice(2);
const b = await launch();
const p = await b.newPage();
await p.setViewport({ width: 1400, height: 1000 });
const out = {};
for (const r of ["", "desk", "positions", "market", "agent", "explorer", "build"]) {
  const errs = [],
    failed = [];
  const onErr = (e) => errs.push(String(e).slice(0, 140));
  const onRes = (res) => {
    // 429: the public RPC. A 404 on /marks: an admin service started before 22 Sep has no such route — expected, not a break.
    if (res.status() === 429 || (res.status() === 404 && res.url().endsWith("/marks"))) return;
    if (res.status() >= 400) failed.push(`${res.status()} ${res.url().slice(0, 90)}`);
  };
  p.on("pageerror", onErr);
  p.on("response", onRes);
  await p.goto(`${base}#/${r}`, { waitUntil: "networkidle2", timeout: 90_000 });
  await wait(12_000);
  const text = await p.evaluate(() => document.body.innerText);
  out[r || "home"] = {
    chars: text.length,
    pageErrors: errs,
    http4xx5xx: [...new Set(failed)],
    suspicious: text.match(/.{0,40}(undefined|NaN|\[object Object\]).{0,40}/g)?.slice(0, 3) ?? [],
  };
  p.off("pageerror", onErr);
  p.off("response", onRes);
}
console.log(JSON.stringify(out, null, 1));
const bad = Object.values(out).some((o) => o.pageErrors.length || o.http4xx5xx.length || o.suspicious.length);
await b.close();
process.exit(bad ? 1 : 0);
