// The link-preview image, taken at the exact Open Graph frame (1200×630) rather than cropped out of
// a taller screenshot — so the hero is composed for the frame instead of clipped to fit it. Re-run
// it whenever the hero changes; app/index.html points og:image and twitter:image at the result.
// usage: node og.mjs [base-url] [out.png]
import { launch, wait } from "./browser.mjs";

const [base = "https://kaustubh76.github.io/Blinds/", out = "../../app/public/og.png"] = process.argv.slice(2);
const b = await launch();
const p = await b.newPage();
await p.setViewport({ width: 1200, height: 630, deviceScaleFactor: 1 });
await p.goto(`${base.replace(/\/$/, "")}/?theme=light&motion=off#/`, { waitUntil: "networkidle2", timeout: 90_000 });
// Long enough for the rate, the window and every collateral card to have answered: a preview showing
// em-dashes where the numbers go is worse than no preview.
await wait(14_000);
// The sticky header is chrome, not content: scroll it away so the frame is the pitch itself.
await p.evaluate(() => window.scrollTo(0, 64));
await wait(600);
await p.screenshot({ path: out });
await b.close();
console.log(`wrote ${out}`);
