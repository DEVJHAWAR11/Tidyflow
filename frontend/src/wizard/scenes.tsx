// Where the wizard appears: only while TidyFlow is doing the work, never while the user is deciding.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Wizard, type WizardHandle } from "./Wizard";
import { burst, cast, fly, idle, spark, tipPoint, wave, type Cancelable } from "./motions";
import { FolderIcon } from "../flow/icons";

const cancelAll = (list: Cancelable[]) => list.forEach((a) => a.cancel());

/* ------------------------------------------------------------------ */
/* Sorting: hovers quietly, and flicks a file into a folder only when   */
/* sorting actually moves forward, so it never feels like a loop.      */
/* ------------------------------------------------------------------ */

const SORT_STAGES = ["scan", "extract", "classify", "finalize"];

export function SortingWizard({ stage: progress }: { stage: string }) {
  const reduced = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const wiz = useRef<WizardHandle>(null);
  const plates = useRef<(HTMLDivElement | null)[]>([]);
  const throwRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const w = wiz.current;
    const s = stage.current;
    if (reduced || !w || !s) return;
    const running: Cancelable[] = [...idle(w)];
    const timers: number[] = [];
    let n = 0;

    let lastCast = -Infinity;
    const throwFile = () => {
      // Quick stages can arrive back to back; keep casts at least 1.5s apart.
      if (performance.now() - lastCast < 1500) return;
      lastCast = performance.now();
      const { anims, release } = cast(w);
      running.push(...anims);
      timers.push(
        window.setTimeout(() => {
          const plate = plates.current[n++ % plates.current.length];
          if (!plate) return;
          const [tx, ty] = tipPoint(w);
          const r = s.getBoundingClientRect();
          const pr = plate.getBoundingClientRect();
          const x0 = tx - r.left - 9;
          const y0 = ty - r.top - 11;
          const x1 = pr.left - r.left + pr.width / 2 - 9;
          const y1 = pr.top - r.top + 4;
          const mx = (x0 + x1) / 2 + 24;
          const my = Math.max(4, Math.min(y0, y1) - 30);

          const file = document.createElement("div");
          file.className = "tf-flying-file";
          s.appendChild(file);
          const frames: Keyframe[] = Array.from({ length: 13 }, (_, i) => {
            const t = i / 12;
            const bx = (1 - t) ** 2 * x0 + 2 * (1 - t) * t * mx + t * t * x1;
            const by = (1 - t) ** 2 * y0 + 2 * (1 - t) * t * my + t * t * y1;
            const scale = t < 0.85 ? 1 : 1 - (t - 0.85) * 5;
            return { transform: `translate(${bx}px,${by}px) rotate(${t * 180}deg) scale(${scale})`, opacity: t > 0.95 ? 0 : 1 };
          });
          const a = file.animate(frames, { duration: 950, easing: "cubic-bezier(.3,.1,.3,1)", fill: "forwards" });
          running.push(a);
          a.onfinish = () => {
            file.remove();
            plate.animate([{ transform: "scale(1)" }, { transform: "scale(1.12)" }, { transform: "scale(1)" }], {
              duration: 320,
              easing: "ease-out",
            });
          };
          for (let i = 0; i < 5; i++) spark(s, tx, ty, { drift: 24, life: 700, scale: 0.8 });
        }, release),
      );
    };

    throwRef.current = throwFile;
    return () => {
      throwRef.current = null;
      timers.forEach(clearTimeout);
      cancelAll(running);
      s.querySelectorAll(".tf-flying-file").forEach((f) => f.remove());
    };
  }, [reduced]);

  // One cast each time sorting reaches a new stage.
  useEffect(() => {
    if (SORT_STAGES.includes(progress)) throwRef.current?.();
  }, [progress]);

  // Choosing folders is the long AI stage: an occasional cast so it never looks frozen.
  useEffect(() => {
    if (progress !== "classify") return;
    let timer = 0;
    const schedule = () => {
      timer = window.setTimeout(() => {
        throwRef.current?.();
        schedule();
      }, 6000 + Math.random() * 4000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [progress]);

  return (
    <div ref={stage} className="relative h-[150px] w-full select-none text-tf-ink">
      <Wizard ref={wiz} size={128} flutter={!reduced} className="absolute left-[4%] top-1" />
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          ref={(el) => {
            plates.current[i] = el;
          }}
          className="absolute bottom-1"
          style={{ left: `calc(${55 + i * 15}% - 20px)` }}
        >
          <FolderIcon name="" glyph={false} size={40} />
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Flight across the window (Done, Undo).                              */
/* ------------------------------------------------------------------ */

interface FlightProps {
  /** Increment to start a flight. 0 means don't fly. */
  play: number;
  /** forward: left to right. back: mirrored, right to left (undo). */
  direction?: "forward" | "back";
  /** Element whose vertical band the wizard flies through. */
  anchor: React.RefObject<HTMLElement | null>;
  /** Called once when the wizard passes the middle of the window. */
  onMidpoint?: () => void;
}

export function WizardFlight({ play, direction = "forward", anchor, onMidpoint }: FlightProps) {
  const reduced = useReducedMotion();
  const lane = useRef<HTMLDivElement>(null);
  const wiz = useRef<WizardHandle>(null);
  const [band, setBand] = useState<{ top: number; height: number } | null>(null);
  const midpoint = useRef(onMidpoint);
  midpoint.current = onMidpoint;

  // Measure the anchor after commit (all refs attached). The lane only renders once measured.
  useEffect(() => {
    if (!play || reduced || !anchor.current) return;
    const r = anchor.current.getBoundingClientRect();
    setBand({ top: r.top + r.height / 2 - 110, height: 220 });
  }, [play, reduced, anchor]);

  useEffect(() => {
    if (!play) return;
    if (reduced) {
      midpoint.current?.();
      return;
    }
    const w = wiz.current;
    const s = lane.current;
    if (!w || !s || !band) return;
    const size = 120;
    const back = direction === "back";
    let passed = false;
    const running: Cancelable[] = [...idle(w, { bob: false })];
    w.el.style.opacity = "1";
    running.push(
      fly(
        s,
        w,
        size,
        (e, W, H) => {
          const t = back ? 1 - e : e;
          const x = -size + t * (W + 2 * size);
          const y = H * 0.62 - Math.sin(e * Math.PI) * H * 0.38;
          const tilt = Math.cos(e * Math.PI) * (back ? 12 : -16);
          return [x, y, tilt];
        },
        {
          duration: 1700,
          mirror: back,
          onProgress: (k) => {
            if (!passed && k >= 0.5) {
              passed = true;
              midpoint.current?.();
            }
            if (k >= 1) w.el.style.opacity = "0";
          },
        },
      ),
    );
    return () => cancelAll(running);
  }, [play, reduced, band, direction]);

  if (!play || reduced || !band) return null;
  return createPortal(
    <div
      ref={lane}
      aria-hidden
      className="pointer-events-none fixed left-0 right-0 z-50 overflow-hidden text-tf-ink"
      style={{ top: band.top, height: band.height }}
    >
      <Wizard ref={wiz} size={120} flutter className="absolute left-0 top-0" style={{ opacity: 0 }} />
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Status line while the AI reads the folder (Plan).                   */
/* ------------------------------------------------------------------ */

export function WizardStatus({ active, label }: { active: boolean; label: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(active);
  const [finishing, setFinishing] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const wiz = useRef<WizardHandle>(null);

  // Become visible as soon as work starts.
  if (active && !shown) setShown(true);

  // Hover while working.
  useEffect(() => {
    const w = wiz.current;
    if (!shown || !active || reduced || !w) return;
    const running = idle(w);
    return () => cancelAll(running);
  }, [shown, active, reduced]);

  // When the work finishes: one cast with a burst, then leave.
  useEffect(() => {
    if (active || !shown) return;
    const w = wiz.current;
    const s = stage.current;
    if (reduced || !w || !s) {
      setShown(false);
      return;
    }
    setFinishing(true);
    const { anims, release } = cast(w, 800);
    const t1 = window.setTimeout(() => burst(s, w, 9, 44), release);
    const t2 = window.setTimeout(() => {
      setShown(false);
      setFinishing(false);
    }, 900);
    return () => {
      cancelAll(anims);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [active, shown, reduced]);

  return (
    <AnimatePresence initial={false}>
      {shown && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        >
          <div ref={stage} className="relative mt-5 flex items-center gap-3 text-tf-ink">
            <Wizard ref={wiz} size={46} flutter={!reduced} />
            <span className="text-[13.5px] text-tf-muted">{finishing ? "Here's the plan." : label}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* First launch: one wave hello, then still.                           */
/* ------------------------------------------------------------------ */

const HELLO_KEY = "tidyflow_wizard_hello";

export function WizardHello() {
  const reduced = useReducedMotion();
  const wiz = useRef<WizardHandle>(null);
  const [firstVisit] = useState(() => {
    try {
      return !localStorage.getItem(HELLO_KEY);
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!firstVisit) return;
    try {
      localStorage.setItem(HELLO_KEY, "1");
    } catch {
      /* private mode: wave again next time, harmless */
    }
    const w = wiz.current;
    if (reduced || !w) return;
    let running: Cancelable[] = [];
    const t = window.setTimeout(() => {
      running = wave(w);
    }, 450);
    return () => {
      clearTimeout(t);
      cancelAll(running);
    };
  }, [firstVisit, reduced]);

  if (!firstVisit) return null;
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="text-tf-ink shrink-0"
    >
      <Wizard ref={wiz} size={96} />
    </motion.div>
  );
}
