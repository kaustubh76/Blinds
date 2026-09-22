// Re-takes docs/screens/*.png from the hosted site (or a dev server): the four pages in light and dark at
// 1280×1100, the Home page on a phone, and the lender agent's card on desktop and phone.
// usage: node screens.mjs [base-url] [out-dir]
import { mkdirSync } from "node:fs";
import { launch, wait } from "./browser.mjs";

const [base = "https://kaustubh76.github.io/Blinds/", outDir = "../../docs/screens"] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const b = await launch();

async function page(width, height, url, ms, scale = 1) {
  const p = await b.newPage();
  await p.setViewport({ width, height, deviceScaleFactor: scale });
  await p.goto(url, { waitUntil: "networkidle2", timeout: 90_000 });
  await wait(ms);
  return p;
}

const cardClip = (p) =>
  p.evaluate(() => {
    const r = document.getElementById("lender-agent")?.getBoundingClientRect();
    return r ? { x: 0, y: r.top + window.scrollY - 8, width: window.innerWidth, height: r.height + 16 } : null;
  });

for (const theme of ["light", "dark"]) {
  const suffix = theme === "dark" ? "-dark" : "";
  for (const [route, ms] of [
    ["", 12_000],
    ["desk", 8_000],
    ["market", 20_000],
    ["agent", 20_000],
    ["explorer", 12_000],
  ]) {
    const p = await page(1280, 1100, `${base}?theme=${theme}#/${route}`, ms);
    await p.screenshot({ path: `${outDir}/${route || "home"}${suffix}.png` });
    if (route === "market") {
      const clip = await cardClip(p);
      if (clip) await p.screenshot({ path: `${outDir}/market-lender${suffix}.png`, clip });
    }
    await p.close();
    console.log(`${route || "home"}${suffix}`);
  }
}
{
  const p = await page(390, 1400, `${base}?theme=light#/`, 12_000, 217 / 390);
  await p.screenshot({ path: `${outDir}/home-phone.png` });
  await p.close();
  const m = await page(390, 900, `${base}?theme=dark#/market`, 20_000, 217 / 390);
  const clip = await cardClip(m);
  if (clip) await m.screenshot({ path: `${outDir}/market-phone.png`, clip });
  await m.close();
  console.log("phones");
}
await b.close();
