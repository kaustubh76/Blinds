/**
 * The backdrop: a sparse field of motes behind the whole app, one per sealed bid, tinted by what the
 * market is doing. It feeds the store in `lib/backdrop.ts` from the window clock and the real-time
 * layer, and paints the pure simulation in `lib/backdropField.ts`. The phase colours are the ring's,
 * read through `token()` so they follow the theme (`components/WindowClock.tsx`).
 *
 * It renders nothing at all when motion is reduced, when the preference is off, or when the browser
 * will not give us a 2D context. The loop stops while the tab is hidden and is capped well below the
 * display's rate: this sits behind a page that already holds a WebSocket and a slot estimator.
 */
import { useEffect, useRef } from "react";
import { backdrop, useBackdropEnabled } from "../lib/backdrop";
import { createField, type FieldState, LINE_Y, rng, stepField } from "../lib/backdropField";
import { devConsole } from "../lib/console";
import { token } from "../lib/theme";
import { useLiveEvents } from "../lib/useLive";
import { useReducedMotion } from "../lib/useReducedMotion";
import { type Phase, useWindowClock } from "../lib/useWindowClock";

/** Retina costs four times the fill for a field this soft; one and a half is past the point of notice. */
const MAX_DPR = 1.5;
/**
 * ~30 fps on a pointer device, ~20 on a touch one. The field drifts; nothing here rewards a higher
 * rate, and on a phone three surfaces (the header, the tab bar, an open console) blur over the
 * canvas, so each painted frame costs a compositor pass through all of them. Measured at 390px under
 * 4x CPU throttling, the median frame is 16.7ms either way — this only trims the tail.
 */
const FRAME_MS = 33;
const FRAME_MS_TOUCH = 50;
/** How often the palette is re-read, in ms. A theme change should follow within about a second. */
const PALETTE_MS = 900;

/** The ring's phase palette, by token name, so the backdrop and the hero clock never disagree. */
const TINT: Record<Phase, string> = {
  loading: "line-strong",
  open: "lend",
  overdue: "status-warning",
  closed: "line-strong",
  printing: "accent",
  printed: "accent",
  notrade: "ink-3",
  idle: "line-strong",
};

interface Palette {
  tint: Record<Phase, string>;
  /** Warm paper takes far less ink than the dark desk before a dot starts to shout. */
  scale: number;
}

/**
 * Which theme is actually painted, read the way the CSS cascade decides it. Not from `useTheme()`:
 * a `?theme=` link pins what that hook reports for the whole page load, while the header's toggle
 * still moves the attribute underneath it — and the backdrop must follow what is on screen.
 */
function isDark(): boolean {
  if (typeof document === "undefined") return false;
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark") return true;
  if (attr === "light") return false;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

function palette(): Palette {
  const tint = {} as Record<Phase, string>;
  for (const [phase, name] of Object.entries(TINT)) tint[phase as Phase] = token(name);
  return { tint, scale: isDark() ? 1 : 0.62 };
}

/**
 * The decision, and nothing else. Everything the backdrop costs — a clock, a real-time reader, a
 * canvas, a frame loop — lives in the child, so a visitor who switches it off or asks for reduced
 * motion pays for none of it. Hooks cannot be conditional, which is the whole reason for the split.
 */
export function Backdrop() {
  const reduced = useReducedMotion();
  const enabled = useBackdropEnabled();
  if (!enabled || reduced) return null;
  return <BackdropCanvas />;
}

function BackdropCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);
  const paletteRef = useRef<Palette | null>(null);

  // The clock and the real-time layer are read *here*, in the leaf, and never in `Shell`. Both are
  // already mounted elsewhere, so this costs no poll and no subscription — but `useWindowClock`
  // re-renders its caller a few times a second, and that must not be the whole page frame. This
  // component emits one canvas with constant props, so a re-render does no DOM work.
  const clock = useWindowClock();
  const live = useLiveEvents();
  useEffect(() => {
    backdrop.setInput({
      phase: clock.phase,
      progress: clock.progress,
      bids: clock.bids,
      connected: live.connected,
    });
  }, [clock.phase, clock.progress, clock.bids, live.connected]);

  useEffect(() => {
    const canvas = ref.current;
    // jsdom, a blocked canvas, or a browser out of contexts — which may return null or throw.
    // Either way: leave the page exactly as it was.
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx = canvas?.getContext?.("2d") ?? null;
    } catch {
      return;
    }
    if (!canvas || !ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    const size = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    size();

    let resizeTimer = 0;
    const onResize = () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(size, 120);
    };

    const next = rng(Date.now() >>> 0);
    let field: FieldState = createField();
    let raf = 0;
    let last = 0;
    let running = true;

    const budget = window.matchMedia?.("(pointer: coarse)").matches ? FRAME_MS_TOUCH : FRAME_MS;
    let repalette = 0;
    const frame = (t: number) => {
      raf = requestAnimationFrame(frame);
      if (t - last < budget) return;
      const dt = last === 0 ? budget : t - last;
      last = t;

      try {
        if (t - repalette > PALETTE_MS) {
          repalette = t;
          paletteRef.current = palette();
        }
        const inp = backdrop.read();
        field = stepField(field, { ...inp, w, h, incoming: backdrop.drain(), next }, dt);
        paint(ctx, field, inp.phase, inp.progress, inp.connected, w, h, paletteRef.current ?? palette());
      } catch (e) {
        // The next frame is already scheduled, so a throw left unhandled here repeats ~30 times a
        // second forever, and no error boundary can reach it. Stop, and leave the page exactly as it
        // looks with the backdrop switched off.
        running = false;
        stop();
        ctx.clearRect(0, 0, w, h);
        devConsole.push({
          kind: "note",
          title: "backdrop: stopped after an error while painting (the page is unaffected)",
          error: e instanceof Error ? e.message : String(e),
        });
      }
    };

    const start = () => {
      if (raf || !running) return;
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      if (!raf) return;
      cancelAnimationFrame(raf);
      raf = 0;
    };
    // A hidden tab pays nothing: the loop is not merely throttled, it is off.
    const onVisibility = () => (document.hidden ? stop() : start());

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    document.addEventListener("visibilitychange", onVisibility);
    if (!document.hidden) start();

    return () => {
      running = false;
      stop();
      window.clearTimeout(resizeTimer);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden="true"
      // A canvas counts as focusable, and this one carries nothing to read or reach.
      tabIndex={-1}
      className="pointer-events-none fixed inset-0 -z-10 h-full w-full"
    />
  );
}

function paint(
  ctx: CanvasRenderingContext2D,
  field: FieldState,
  phase: Phase,
  progress: number,
  connected: boolean,
  w: number,
  h: number,
  pal: Palette,
) {
  ctx.clearRect(0, 0, w, h);
  const tint = pal.tint[phase] ?? pal.tint.idle;
  // The real-time layer having given up is a fact worth showing: the field dims rather than pretends.
  const scale = pal.scale * (connected ? 1 : 0.7);
  const lineY = LINE_Y * h;
  // A pulse is seen as a brief lift of the whole field, not as the ring alone.
  const flash = field.flash;

  // The sweep: where this window has got to. Only while one is open, and only ever a hint — soft on
  // both sides, because a hard edge reads as a rendering fault rather than as time passing.
  if (phase === "open" && progress > 0) {
    const x = progress * w;
    const half = 220;
    const left = Math.max(0, x - half);
    const right = Math.min(w, x + half * 0.35);
    if (right > left) {
      const band = ctx.createLinearGradient(left, 0, right, 0);
      band.addColorStop(0, "transparent");
      band.addColorStop(Math.min(0.98, (x - left) / (right - left)), tint);
      band.addColorStop(1, "transparent");
      ctx.globalAlpha = 0.07 * scale;
      ctx.fillStyle = band;
      ctx.fillRect(left, 0, right - left, h);
    }
  }

  // The clearing line.
  if (field.line + flash > 0.01) {
    const grad = ctx.createLinearGradient(0, 0, w, 0);
    grad.addColorStop(0, "transparent");
    grad.addColorStop(0.5, tint);
    grad.addColorStop(1, "transparent");
    ctx.globalAlpha = (field.line * 0.3 + flash * 0.34) * scale;
    ctx.fillStyle = grad;
    ctx.fillRect(0, lineY - 0.5, w, 1);
  }

  // The stamp: the print landing, once, across the line.
  if (field.stamp > 0.01) {
    const spread = (1 - field.stamp) * 40 + 6;
    const grad = ctx.createLinearGradient(0, lineY - spread, 0, lineY + spread);
    grad.addColorStop(0, "transparent");
    grad.addColorStop(0.5, tint);
    grad.addColorStop(1, "transparent");
    ctx.globalAlpha = field.stamp * 0.16 * scale;
    ctx.fillStyle = grad;
    ctx.fillRect(0, lineY - spread, w, spread * 2);
  }

  // The motes.
  ctx.fillStyle = tint;
  for (const m of field.motes) {
    const fade = Math.min(1, m.age);
    const r = 1.0 + m.seed * 1.9;
    ctx.globalAlpha = (0.14 + m.seed * 0.16) * (1 + flash * 1.3) * fade * scale;
    ctx.beginPath();
    ctx.arc(m.x * w, m.y * h, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // The pulses: something happened, here, a moment ago.
  ctx.strokeStyle = tint;
  for (const p of field.pulses) {
    const grown = 1 - p.life;
    // The ring thins as it widens, the way a ripple does, and fades linearly so it can be followed
    // rather than merely glimpsed.
    ctx.lineWidth = 0.6 + p.life * 1.8;
    ctx.globalAlpha = p.life * 0.5 * scale;
    ctx.beginPath();
    ctx.arc(p.x * w, p.y * h, 10 + grown * (p.kind === "print" ? 300 : 90), 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}
