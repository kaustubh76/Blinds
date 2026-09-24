// The parts of the dashboard a page load does not reach: the wallet menu, the settings toggles, the
// developer console, and the fact that one chain event should print one line however many components
// are watching it. Every check here exists because that exact thing was broken once.
// usage: node interactive.mjs <base url>
import { bigintSafe, launch, wait } from "./browser.mjs";

const [base = "https://kaustubh76.github.io/Blinds/"] = process.argv.slice(2);
const out = {};
const errors = [];
const check = (name, ok, detail) => {
  out[name] = ok ? "ok" : `FAIL — ${detail}`;
};

const b = await launch();

// A burner needs no faucet: the key is made in the browser. Only joining the desk needs the service,
// which is why this driver can run against the hosted site whether or not a market is up.
const takeBurner = (p) =>
  p.evaluate(() => [...document.querySelectorAll("button")].find((x) => /devnet burner/i.test(x.textContent))?.click());
const chip = (p) =>
  p.evaluate(() => {
    const el = [...document.querySelectorAll("header button")].find((x) => /…/.test(x.textContent || ""));
    return (
      el && {
        text: el.textContent.trim(),
        expanded: el.getAttribute("aria-expanded"),
        popup: el.getAttribute("aria-haspopup"),
      }
    );
  });
const openChip = (p) =>
  p.evaluate(() => [...document.querySelectorAll("header button")].find((x) => /…/.test(x.textContent || ""))?.click());

async function page(width, height, hash = "") {
  const p = await b.newPage();
  await p.setViewport({ width, height, isMobile: width < 500, hasTouch: width < 500 });
  p.on("pageerror", (e) => errors.push(String(e).slice(0, 160)));
  await p.goto(`${base}${hash}`, { waitUntil: "networkidle2", timeout: 90_000 });
  await wait(5000);
  return p;
}

// 1. The menu at phone width, with the developer console open — the two ways it has been unusable.
//    Horizontally: a 16rem panel anchored to a chip 218px from the left edge of a 390px screen
//    starts at -38px, and the body's `overflow-x: hidden` deletes those pixels silently.
//    Vertically: a `fixed` panel inside the header anchors to the *header*, because `backdrop-blur`
//    there makes it a containing block — which put the sheet at top:-111, entirely off screen.
//    Measuring only the left and right edges missed that for a whole pass, so measure all four, and
//    then ask the browser what is actually on top at the menu's own centre.
{
  const p = await page(390, 844);
  await p.evaluate(() =>
    [...document.querySelectorAll("button")]
      .find((x) => (x.getAttribute("title") || "").includes("developer console"))
      ?.click(),
  );
  await wait(600);
  await p.evaluate(() => [...document.querySelectorAll("button")].find((x) => /connect/i.test(x.textContent))?.click());
  await wait(700);
  const box = await p.evaluate(() => {
    const m = document.querySelector("[data-wallet-menu]");
    if (!m) return null;
    const r = m.getBoundingClientRect();
    const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
    return {
      onScreen: r.top >= 0 && r.left >= 0 && r.bottom <= window.innerHeight && r.right <= window.innerWidth,
      reachable: !!(hit && m.contains(hit)),
      rect: [r.top, r.right, r.bottom, r.left].map(Math.round),
      viewport: [window.innerWidth, window.innerHeight],
    };
  });
  check("phone menu opens", !!box, "no [data-wallet-menu] after clicking Connect");
  check("phone menu fully on screen", !!box && box.onScreen, JSON.stringify(box));
  check("phone menu above the console", !!box && box.reachable, JSON.stringify(box));
  await p.close();
}

// 2. The wallet round trip. Disconnecting used to throw WALLET_ACCOUNT_NOT_FOUND to the error screen,
//    because the session let go of the account only after the wallet had already dropped it.
{
  const p = await page(1280, 900);
  await takeBurner(p);
  await wait(4000);
  const c = await chip(p);
  check("chip shows a short address", !!c && /…/.test(c.text), JSON.stringify(c));
  check("chip announces a menu", c?.popup === "menu" && c?.expanded === "false", JSON.stringify(c));
  await openChip(p);
  await wait(500);
  const open = await p.evaluate(() => ({
    expanded: [...document.querySelectorAll("header button")]
      .find((x) => /…/.test(x.textContent || ""))
      ?.getAttribute("aria-expanded"),
    menu: !!document.querySelector("[data-wallet-menu='account']"),
    full: (document.querySelector("[data-wallet-menu] code")?.textContent || "").length,
    disconnect: !!document.querySelector("[data-wallet-menu] button"),
  }));
  check("menu opens", open.menu && open.expanded === "true", JSON.stringify(open));
  check("menu holds the full address", open.full >= 32, `address length ${open.full}`);
  check("menu offers Disconnect", open.disconnect, "no button in the menu");
  await p.evaluate(() =>
    [...document.querySelectorAll("button")].find((x) => /^disconnect$/i.test((x.textContent || "").trim()))?.click(),
  );
  await wait(2500);
  const back = await p.evaluate(() =>
    [...document.querySelectorAll("header button")].some((x) => /connect/i.test(x.textContent || "")),
  );
  check("Disconnect returns to Connect", back, "the header did not come back — check for a crash to the error screen");
  await p.close();
}

// 3. The motion preference commits at once, unlike the endpoint settings beside it, which need a reload.
{
  const p = await page(1280, 900);
  const canvas = () => p.evaluate(() => !!document.querySelector("canvas"));
  check("backdrop is on by default", await canvas(), "no canvas on load");
  await p.evaluate(() =>
    [...document.querySelectorAll("button")].find((x) => x.getAttribute("title") === "settings")?.click(),
  );
  await wait(700);
  const toggle = () => p.evaluate(() => document.querySelector("[data-pref='backdrop']")?.click());
  await toggle();
  await wait(700);
  check("motion off removes the canvas", !(await canvas()), "the canvas survived the toggle");
  await toggle();
  await wait(700);
  check("motion on restores it", await canvas(), "the canvas did not come back");
  await p.close();
}

// 4. One clock. The transition key used to live in a `useRef`, so each of the two or three mounted
//    clocks announced the same chain event again — and each ran its own slot estimator, which raced
//    the others to write the measured slot rate that every displayed duration is rendered through.
{
  const p = await page(1280, 900);
  for (const r of ["market", "", "market", ""]) {
    await p.evaluate((h) => {
      window.location.hash = `#/${h}`;
    }, r);
    await wait(3500);
  }
  const lines = await p.evaluate(() =>
    window.thewindow.console
      .getSnapshot()
      .filter((e) => e.kind === "chain")
      .map((e) => e.title),
  );
  const dupes = lines.filter((t, i) => lines.indexOf(t) !== i);
  check("one line per transition", dupes.length === 0, `${lines.length} lines, duplicated: ${JSON.stringify(dupes)}`);
  const stopped = await p.evaluate(() =>
    window.thewindow.console.getSnapshot().some((e) => /backdrop: stopped/.test(e.title)),
  );
  check("the backdrop never stopped", !stopped, "the frame loop caught an error and shut itself down");
  await p.close();
}

console.log(JSON.stringify({ out, errors }, bigintSafe, 1));
await b.close();
process.exit(Object.values(out).every((v) => v === "ok") && errors.length === 0 ? 0 : 1);
