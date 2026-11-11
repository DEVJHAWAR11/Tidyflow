// First launch: three short steps (what TidyFlow does, how it should read files, pick a folder).
// It can be skipped at any point and shown again from Settings.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, FolderOpen, FolderSearch, ListChecks, ShieldCheck, Undo2, HardDrive, Check } from "lucide-react";
import { Button, ease } from "./ui";
import { FolderIcon } from "./icons";
import { Wizard, WizardPose, type WizardHandle } from "../wizard/Wizard";
import { idle, wave, type Cancelable } from "../wizard/motions";
import { poseBurst } from "../wizard/scenes";
import { AiSetup, providerName, useAiSettings } from "../components/AiSetup";

export interface OnboardingProps {
  /** Close the welcome (finished or skipped) */
  onDone: () => void;
  /** Close it and open the folder chooser */
  onChooseFolder: () => void;
  /** Runs after an AI setting is saved, so the rest of the app can pick it up */
  onSettingsChanged: () => void;
}

const STEPS = ["Welcome", "Smart sorting", "Ready"] as const;

/** The wizard on his broom: waves once, then hovers. */
function WavingWizard({ size }: { size: number }) {
  const reduced = useReducedMotion();
  const wiz = useRef<WizardHandle>(null);
  useEffect(() => {
    const w = wiz.current;
    if (reduced || !w) return;
    let running: Cancelable[] = idle(w);
    const t = window.setTimeout(() => {
      running = [...running, ...wave(w)];
    }, 500);
    return () => {
      clearTimeout(t);
      running.forEach((a) => a.cancel());
    };
  }, [reduced]);
  return <Wizard ref={wiz} size={size} flutter className="text-tf-ink" />;
}

/** The wizard casting, with one burst of sparkles from the wand. */
function CastingWizard({ size }: { size: number }) {
  const reduced = useReducedMotion();
  const stage = useRef<HTMLDivElement>(null);
  const pose = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (reduced) return;
    const t = window.setTimeout(() => stage.current && poseBurst(stage.current, pose.current, 12, 56), 350);
    return () => clearTimeout(t);
  }, [reduced]);
  return (
    <div ref={stage} className="relative text-tf-ink">
      <WizardPose ref={pose} pose="casting" size={size} />
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { icon: <FolderSearch size={16} strokeWidth={1.75} />, title: "Choose a folder", note: "Downloads, Desktop, or any messy folder." },
    { icon: <ListChecks size={16} strokeWidth={1.75} />, title: "See the plan", note: "TidyFlow proposes folders and shows where each file would go." },
    { icon: <Check size={16} strokeWidth={2} />, title: "Approve it", note: "Nothing moves until you say so. Change anything first." },
  ];
  return (
    <ol className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
      {steps.map((s, i) => (
        <li key={s.title} className="rounded-[10px] border border-tf-border-strong bg-tf-surface p-3.5">
          <div className="flex items-center gap-2 text-tf-ink">
            <span className="w-6 h-6 rounded-full bg-tf-surface-3 grid place-items-center text-[12px] font-semibold tf-num">{i + 1}</span>
            {s.icon}
          </div>
          <div className="mt-2 text-[13.5px] font-medium text-tf-ink">{s.title}</div>
          <p className="mt-0.5 text-[12.5px] leading-snug text-tf-muted">{s.note}</p>
        </li>
      ))}
    </ol>
  );
}

export function Onboarding({ onDone, onChooseFolder, onSettingsChanged }: OnboardingProps) {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const ai = useAiSettings(onSettingsChanged);
  const reduced = useReducedMotion();
  const heading = useRef<HTMLHeadingElement>(null);

  const s = ai.settings;
  const usable = !!s?.ai_enabled && !!s?.has_key && !ai.aiError;

  const go = (to: number) => {
    setDirection(to > step ? 1 : -1);
    setStep(to);
  };

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Move focus to the new step's heading so keyboard and screen-reader users follow along.
  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  const slide = reduced
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
        initial: { opacity: 0, x: 24 * direction },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -24 * direction },
      };

  return createPortal(
    <div
      className="fixed inset-0 z-[9000] bg-tf-bg text-tf-ink overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to TidyFlow"
    >
      <div className="min-h-full max-w-[660px] mx-auto px-5 py-6 flex flex-col">
        {/* Top: where you are, and a way out */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-1.5" aria-label={`Step ${step + 1} of ${STEPS.length}: ${STEPS[step]}`}>
            {STEPS.map((name, i) => (
              <span
                key={name}
                className={`h-1.5 rounded-full transition-all duration-300 ${
                  i === step ? "w-6 bg-tf-ink" : i < step ? "w-1.5 bg-tf-ink" : "w-1.5 bg-tf-border-strong"
                }`}
              />
            ))}
          </div>
          <Button variant="ghost" size="sm" onClick={onDone}>
            Skip
          </Button>
        </div>

        <div className="flex-1 flex flex-col justify-center py-8">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={step} {...slide} transition={{ duration: 0.22, ease }}>
              {step === 0 && (
                <div>
                  <div className="flex justify-center">
                    <WavingWizard size={150} />
                  </div>
                  <h1
                    ref={heading}
                    tabIndex={-1}
                    className="mt-4 text-center text-[30px] leading-[1.15] font-semibold tracking-[-0.9px] focus:outline-none"
                  >
                    Welcome to TidyFlow
                  </h1>
                  <p className="mt-2.5 text-center text-[16px] leading-[1.5] text-tf-muted max-w-md mx-auto">
                    Point it at a messy folder and it sorts the files into tidy ones. You see every move before it happens.
                  </p>
                  <div className="mt-8">
                    <HowItWorks />
                  </div>
                  <div className="mt-5 flex flex-wrap justify-center gap-x-6 gap-y-2 text-[12.5px] text-tf-muted">
                    <span className="flex items-center gap-2">
                      <ShieldCheck size={14} strokeWidth={1.75} /> Nothing changes without your approval
                    </span>
                    <span className="flex items-center gap-2">
                      <Undo2 size={14} strokeWidth={1.75} /> Undo any time
                    </span>
                    <span className="flex items-center gap-2">
                      <HardDrive size={14} strokeWidth={1.75} /> Files stay on your computer
                    </span>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div>
                  <div className="flex items-center gap-4">
                    <WizardPose pose="reading" size={84} className="text-tf-ink shrink-0" />
                    <div>
                      <h1
                        ref={heading}
                        tabIndex={-1}
                        className="text-[26px] leading-[1.2] font-semibold tracking-[-0.7px] focus:outline-none"
                      >
                        How should TidyFlow read your files?
                      </h1>
                      <p className="mt-1.5 text-[14.5px] leading-[1.5] text-tf-muted">
                        With AI it understands what a file is about, not just its name, so far fewer files are left for you to
                        sort by hand. You can change this later in Settings.
                      </p>
                    </div>
                  </div>
                  <div className="mt-6 rounded-[var(--radius-tf-card)] border border-tf-border-strong bg-tf-surface p-4">
                    <AiSetup ai={ai} />
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="text-center">
                  <div className="flex justify-center">
                    <CastingWizard size={150} />
                  </div>
                  <h1
                    ref={heading}
                    tabIndex={-1}
                    className="mt-4 text-[30px] leading-[1.15] font-semibold tracking-[-0.9px] focus:outline-none"
                  >
                    You're all set
                  </h1>
                  <p className="mt-2.5 text-[16px] leading-[1.5] text-tf-muted max-w-md mx-auto">
                    {usable
                      ? `Smart sorting is on, using your ${providerName(s!.provider)} key.`
                      : "TidyFlow will sort by file type and name. You can turn on AI in Settings whenever you like."}
                  </p>
                  <div className="mt-7 inline-flex items-center gap-3 rounded-[10px] border border-tf-border-strong bg-tf-surface px-4 py-3 text-left">
                    <FolderIcon name="" glyph={false} size={36} />
                    <div>
                      <div className="text-[13.5px] font-medium text-tf-ink">Start with a folder you know is messy</div>
                      <div className="text-[12.5px] text-tf-muted">Downloads is a good first one.</div>
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Bottom: back and forward */}
        <div className="flex items-center justify-between gap-3 pt-2">
          {step > 0 ? (
            <Button variant="ghost" size="lg" icon={<ArrowLeft size={15} strokeWidth={1.75} />} onClick={() => go(step - 1)}>
              Back
            </Button>
          ) : (
            <span />
          )}
          {step === 0 && (
            <Button variant="primary" size="lg" iconRight={<ArrowRight size={15} strokeWidth={1.75} />} onClick={() => go(1)}>
              Get started
            </Button>
          )}
          {step === 1 && (
            <Button variant="primary" size="lg" iconRight={<ArrowRight size={15} strokeWidth={1.75} />} onClick={() => go(2)}>
              {usable ? "Continue" : s && !s.ai_enabled ? "Continue without AI" : "Skip this for now"}
            </Button>
          )}
          {step === 2 && (
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="lg" onClick={onDone}>
                Look around first
              </Button>
              <Button variant="primary" size="lg" icon={<FolderOpen size={15} strokeWidth={1.75} />} onClick={onChooseFolder}>
                Choose a folder
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
