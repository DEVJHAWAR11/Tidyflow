// Imperative animations for the wizard rig (Web Animations API). Each helper returns
// something with cancel() so scenes can stop everything on unmount.
import type { WizardHandle } from "./Wizard";

export interface Cancelable {
  cancel(): void;
}

const io = "cubic-bezier(.37,0,.63,1)";
const swing = "cubic-bezier(.45,0,.2,1)";

/** Keyframes as [offset, degrees], eased per segment so motion never moves at constant speed. */
function rotation(pairs: [number, number][], easing = io): Keyframe[] {
  return pairs.map(([offset, deg]) => ({ offset, transform: `rotate(${deg}deg)`, easing }));
}

/** Ambient life: broom tail flicker, plus an optional slow bob. */
export function idle(w: WizardHandle, { bob = true } = {}): Cancelable[] {
  const anims: Animation[] = [
    w.bristles.animate(rotation([[0, 0], [0.25, -3], [0.5, 1.5], [0.75, -2], [1, 0]], "ease-in-out"), {
      duration: 900,
      iterations: Infinity,
    }),
  ];
  if (bob) {
    anims.push(
      w.root.animate(
        [
          { transform: "translateY(0) rotate(0deg)" },
          { transform: "translateY(-9px) rotate(-1.2deg)" },
          { transform: "translateY(0) rotate(0deg)" },
        ],
        { duration: 2600, iterations: Infinity, easing: "ease-in-out" },
      ),
    );
  }
  return anims;
}

/** Wand winds back, sweeps up and flicks; `release` is when (ms) the flick lands. */
export function cast(w: WizardHandle, duration = 900): { anims: Animation[]; release: number } {
  const o: KeyframeAnimationOptions = { duration, fill: "both" };
  return {
    anims: [
      w.arm.animate(rotation([[0, 0], [0.3, -8], [0.62, 20], [1, 0]], swing), o),
      w.hand.animate(rotation([[0, 0], [0.35, -6], [0.6, 14], [1, 0]], swing), o),
    ],
    release: duration * 0.5,
  };
}

/** Arm lifts, the wrist waves with decaying swings, head and cape follow a beat late. */
export function wave(w: WizardHandle): Animation[] {
  const o: KeyframeAnimationOptions = { duration: 2600, fill: "both" };
  return [
    w.arm.animate(rotation([[0, 0], [0.07, -4], [0.2, 21], [0.27, 17], [0.5, 19], [0.72, 16], [0.86, 6], [1, 0]]), o),
    w.hand.animate(rotation([[0, 0], [0.2, -6], [0.3, 26], [0.4, -14], [0.5, 22], [0.6, -8], [0.7, 13], [0.8, 0], [1, 0]]), o),
    w.head.animate(rotation([[0, 0], [0.26, 0], [0.38, -4], [0.62, -3], [0.9, 1], [1, 0]]), o),
    w.cape.animate(rotation([[0, 0], [0.24, 0], [0.4, -3], [0.7, -2], [1, 0]]), o),
  ];
}

/** Viewport position of the wand tip. */
export function tipPoint(w: WizardHandle): [number, number] {
  const b = w.tip.getBoundingClientRect();
  return [b.left + b.width / 2, b.top + b.height / 2];
}

const STAR =
  '<svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M5 0C5.4 3.2 6.8 4.6 10 5C6.8 5.4 5.4 6.8 5 10C4.6 6.8 3.2 5.4 0 5C3.2 4.6 4.6 3.2 5 0Z" fill="currentColor"/></svg>';

/** One sparkle at a viewport point, drawn inside `stage` (which must be position: relative). */
export function spark(stage: HTMLElement, x: number, y: number, { drift = 18, life = 900, scale = 1 } = {}) {
  const s = document.createElement("div");
  s.innerHTML = STAR;
  const r = stage.getBoundingClientRect();
  Object.assign(s.style, {
    position: "absolute",
    left: `${x - r.left - 5}px`,
    top: `${y - r.top - 5}px`,
    width: "10px",
    height: "10px",
    pointerEvents: "none",
  });
  stage.appendChild(s);
  const dx = (Math.random() - 0.5) * drift;
  const dy = (Math.random() * 0.6 + 0.2) * drift;
  const sc = (0.5 + Math.random() * 0.7) * scale;
  s.animate(
    [
      { transform: `translate(0,0) scale(${sc}) rotate(0deg)`, opacity: 1 },
      { transform: `translate(${dx}px,${dy}px) scale(0) rotate(${(Math.random() - 0.5) * 180}deg)`, opacity: 0 },
    ],
    { duration: life * (0.7 + Math.random() * 0.6), easing: "cubic-bezier(.2,.6,.3,1)", fill: "forwards" },
  ).onfinish = () => s.remove();
}

export function burst(stage: HTMLElement, w: WizardHandle, count = 8, drift = 40) {
  const [x, y] = tipPoint(w);
  for (let i = 0; i < count; i++) spark(stage, x, y, { drift, life: 850 });
}

/**
 * Fly the wizard's element along a path, leaving a sparkle trail from the wand.
 * `path(e)` gets eased progress 0..1 and returns [x, y, degrees] of the wizard centre in stage pixels.
 */
export function fly(
  stage: HTMLElement,
  w: WizardHandle,
  size: number,
  path: (e: number, width: number, height: number) => [number, number, number],
  { duration = 2000, mirror = false, onProgress }: { duration?: number; mirror?: boolean; onProgress?: (k: number) => void } = {},
): Cancelable {
  let start: number | undefined;
  let raf = 0;
  let lastSpark = 0;
  const step = (t: number) => {
    start ??= t;
    const k = Math.min(1, (t - start) / duration);
    const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
    const [x, y, deg] = path(e, stage.clientWidth, stage.clientHeight);
    w.el.style.transform = `translate(${x - size / 2}px, ${y - size / 2}px) rotate(${deg}deg) scaleX(${mirror ? -1 : 1})`;
    if (t - lastSpark > 28 && k > 0.02 && k < 0.98) {
      lastSpark = t;
      const [sx, sy] = tipPoint(w);
      spark(stage, sx, sy, { drift: 14, life: 1100, scale: 0.9 });
    }
    onProgress?.(k);
    if (k < 1) raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return { cancel: () => cancelAnimationFrame(raf) };
}
