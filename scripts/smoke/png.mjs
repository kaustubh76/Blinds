// Rasterises an SVG to a square PNG (token images for launch venues want a raster). usage: node png.mjs in.svg out.png [size]
import { readFileSync } from "node:fs";
import { launch } from "./browser.mjs";

const [svgPath, outPath, sizeArg = "512"] = process.argv.slice(2);
if (!svgPath || !outPath) throw new Error("usage: node png.mjs in.svg out.png [size]");
const size = Number(sizeArg);
const svg = readFileSync(svgPath, "utf8");
const b = await launch();
const p = await b.newPage();
await p.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
await p.setContent(
  `<html><body style="margin:0;background:#0b0b0f;width:${size}px;height:${size}px;display:grid;place-items:center">
     <div style="width:${Math.round(size * 0.78)}px;height:${Math.round(size * 0.78)}px">${svg.replace(/width="\d+" height="\d+"/, 'width="100%" height="100%"')}</div>
   </body></html>`,
);
await p.screenshot({ path: outPath, clip: { x: 0, y: 0, width: size, height: size } });
await b.close();
console.log(`wrote ${outPath} (${size}×${size})`);
