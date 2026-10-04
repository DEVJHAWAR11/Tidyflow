// Where the wizard appears: only while TidyFlow is doing the work, never while the user is deciding.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Wizard, WizardPose, type WizardHandle } from "./Wizard";
import { cast, fly, idle, spark, tipPoint, wave, type Cancelable } from "./motions";
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
/* Done: flies in and lands as the standing pose; Undo: takes off.     */
/* ------------------------------------------------------------------ */

interface FlightProps {
  /** Increment to start a flight. 0 means don't fly. */
  play: number;
  /** land: fly in from the left and touch down on `target`. takeoff: leave from `target`, back to the left. */
  mode: "land" | "takeoff";
  /** Where the wizard lands, or takes off from. */
  target: React.RefObject<HTMLElement | null>;
  /** Called when the flight ends (on landing, the standing pose takes over). */
  onDone?: () => void;
}

const FLIGHT_SIZE = 96;

export function WizardFlight({ play, mode, target, onDone }: FlightProps) {
  const reduced = useReducedMotion();
  const lane = useRef<HTMLDivElement>(null);
  const wiz = useRef<WizardHandle>(null);
  const [flying, setFlying] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;

  // Start after commit, when the target has been laid out and measured.
  useEffect(() => {
    if (!play) return;
    if (reduced) {
      done.current?.();
      return;
    }
    setFlying(play);
  }, [play, reduced]);

  useEffect(() => {
    const w = wiz.current;
    const s = lane.current;
    const t = target.current;
    if (!flying || !w || !s || !t) return;
    const r = t.getBoundingClientRect();
    const tx = r.left + r.width / 2;
    const ty = r.top + r.height / 2;
    const size = FLIGHT_SIZE;
    const landing = mode === "land";
    const running: Cancelable[] = [...idle(w, { bob: false })];
    w.el.style.opacity = "1";
    running.push(
      fly(
        s,
        w,
        size,
        (e) =>
          landing
            ? [-size + (tx + size) * e, ty - 150 * (1 - e) - Math.sin(e * Math.PI) * 50, -14 * (1 - e)]
            : [tx - (tx + size) * e, ty - 190 * e - Math.sin(e * Math.PI) * 40, 12 * e],
        {
          duration: landing ? 1500 : 1300,
          mirror: !landing,
          onProgress: (k) => {
            if (k < 1) return;
            w.el.style.opacity = "0";
            setFlying(0);
            done.current?.();
          },
        },
      ),
    );
    return () => cancelAll(running);
  }, [flying, mode, target]);

  if (!flying) return null;
  return createPortal(
    <div ref={lane} aria-hidden className="pointer-events-none fixed inset-0 z-50 overflow-hidden text-tf-ink">
      <Wizard ref={wiz} size={FLIGHT_SIZE} flutter className="absolute left-0 top-0" style={{ opacity: 0 }} />
    </div>,
    document.body,
  );
}

/** Sparkle burst from a pose's wand tip. `stage` must be position: relative. */
export function poseBurst(stage: HTMLElement, pose: HTMLElement | null, count = 9, drift = 44) {
  const tip = pose?.querySelector("[data-tip]");
  if (!tip) return;
  const b = tip.getBoundingClientRect();
  for (let i = 0; i < count; i++) spark(stage, b.left, b.top, { drift, life: 850 });
}

/* ------------------------------------------------------------------ */
/* Plan: reads a scroll while the AI reads the folder, then casts.     */
/* ------------------------------------------------------------------ */

export function WizardStatus({ active, label }: { active: boolean; label: string }) {
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(active);
  const [finishing, setFinishing] = useState(false);
  const stage = useRef<HTMLDivElement>(null);
  const figure = useRef<HTMLDivElement>(null);
  const caster = useRef<HTMLDivElement>(null);

  // Become visible as soon as work starts.
  if (active && !shown) setShown(true);

  // Bob gently while reading.
  useEffect(() => {
    const el = figure.current;
    if (!shown || !active || reduced || !el) return;
    const a = el.animate(
      [
        { transform: "translateY(0) rotate(0deg)" },
        { transform: "translateY(-4px) rotate(-1.5deg)" },
        { transform: "translateY(0) rotate(0deg)" },
      ],
      { duration: 2600, iterations: Infinity, easing: "ease-in-out" },
    );
    return () => a.cancel();
  }, [shown, active, reduced]);

  // When the work finishes: switch to the casting pose, one burst, then leave.
  useEffect(() => {
    if (active || !shown) return;
    if (reduced) {
      setShown(false);
      return;
    }
    setFinishing(true);
    const t1 = window.setTimeout(() => stage.current && poseBurst(stage.current, caster.current), 160);
    const t2 = window.setTimeout(() => {
      setShown(false);
      setFinishing(false);
    }, 1100);
    return () => {
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
            <div ref={figure} className="relative w-[58px] h-[58px] shrink-0">
              <AnimatePresence initial={false}>
                {finishing ? (
                  <motion.div
                    key="casting"
                    className="absolute inset-0"
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.16 }}
                  >
                    <WizardPose ref={caster} pose="casting" size={58} />
                  </motion.div>
                ) : (
                  <motion.div key="reading" className="absolute inset-0" exit={{ opacity: 0 }} transition={{ duration: 0.12 }}>
                    <WizardPose pose="reading" size={58} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
            <span className="text-[13.5px] text-tf-muted">{finishing ? "Here's the plan." : label}</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* ------------------------------------------------------------------ */
/* Still moments: sitting (nothing to do yet), braking (stopped).      */
/* ------------------------------------------------------------------ */

/** Sitting on the hovering broom, for empty states. Settles in once, then stays still. */
export function WizardWaiting({ size = 96 }: { size?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="text-tf-ink"
      initial={reduced ? false : { opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 160, damping: 14 }}
    >
      <WizardPose pose="sitting" size={size} />
    </motion.div>
  );
}

/** Braking to a stop, for when the user cancels. Skids in once. */
export function WizardStopped({ size = 96 }: { size?: number }) {
  const reduced = useReducedMotion();
  return (
    <motion.div
      className="text-tf-ink"
      initial={reduced ? false : { opacity: 0, x: -40, rotate: 8 }}
      animate={{ opacity: 1, x: 0, rotate: 0 }}
      transition={{ type: "spring", stiffness: 220, damping: 13 }}
    >
      <WizardPose pose="braking" size={size} />
    </motion.div>
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
