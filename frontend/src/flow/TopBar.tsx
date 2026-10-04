import { motion, AnimatePresence } from "motion/react";
import { Search, Settings2, Moon, Sun, Check, ArrowLeft } from "lucide-react";
import { Pill, Dot } from "./ui";
import type { TopBarProps, FlowStep } from "./contracts";
import logoImg from "../assets/logo.png";

const STEPS: { id: FlowStep; label: string; number: number }[] = [
  { id: "home", label: "Folder", number: 1 },
  { id: "plan", label: "Plan", number: 2 },
  { id: "preview", label: "Review", number: 3 },
  { id: "done", label: "Done", number: 4 },
];

export function TopBar({
  view,
  step,
  reachableSteps,
  onGoToStep,
  onOpenView,
  darkMode,
  toggleDarkMode,
  backendStatus,
}: TopBarProps) {
  // When sorting, treat as Plan, highlighting Plan step
  const activeStepId: FlowStep = step === "sorting" ? "plan" : step;
  const activeIndex = STEPS.findIndex((s) => s.id === activeStepId);

  return (
    <header className="sticky top-0 z-40 h-[52px] bg-tf-bg/80 backdrop-blur-md border-b border-tf-border select-none">
      <div className="max-w-6xl mx-auto px-5 h-full flex items-center justify-between gap-4">
        {/* Left: Brand */}
        <button
          type="button"
          onClick={() => onOpenView("flow")}
          className="flex items-center gap-2.5 rounded-[8px] py-1 text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40"
          aria-label="TidyFlow home"
        >
          <div className="w-[26px] h-[26px] rounded-[7px] bg-tf-surface border border-tf-border flex items-center justify-center shrink-0 overflow-hidden">
            <img src={logoImg} alt="" className="w-[22px] h-[22px] object-contain" />
          </div>
          <span className="text-[14px] font-semibold text-tf-ink tracking-tight hidden sm:inline">
            TidyFlow
          </span>
        </button>

        {/* Center: Steps or Back button */}
        {view === "flow" && step !== "home" ? (
          <nav aria-label="Progress" className="flex items-center gap-1.5">
            {STEPS.map((s, idx) => {
              const isCurrent = s.id === activeStepId;
              const isCompleted = idx < activeIndex;
              const isReachable = reachableSteps.includes(s.id);

              const circle = isCurrent ? (
                <div className="w-[18px] h-[18px] rounded-full bg-tf-primary text-tf-on-primary flex items-center justify-center shrink-0">
                  <span className="tf-num text-[11px] font-semibold leading-none">{s.number}</span>
                </div>
              ) : isCompleted ? (
                <div className="w-[18px] h-[18px] rounded-full bg-tf-surface-3 flex items-center justify-center shrink-0">
                  <Check size={11} strokeWidth={3} className="text-tf-ink-2" />
                </div>
              ) : (
                <div className="w-[18px] h-[18px] rounded-full border border-tf-border-strong flex items-center justify-center shrink-0">
                  <span className="tf-num text-[11px] text-tf-faint leading-none">{s.number}</span>
                </div>
              );

              const labelClass = isCurrent
                ? "text-[13px] text-tf-ink font-medium hidden sm:inline"
                : isCompleted
                ? "text-[13px] text-tf-ink-2 hidden sm:inline"
                : "text-[13px] text-tf-faint hidden sm:inline";

              return (
                <div key={s.id} className="flex items-center gap-1.5">
                  {idx > 0 && <div className="w-5 h-px bg-tf-border-strong shrink-0" />}

                  {isReachable && !isCurrent ? (
                    <button
                      type="button"
                      onClick={() => onGoToStep(s.id)}
                      className="flex items-center gap-1.5 hover:bg-tf-surface-2 rounded-[7px] px-1.5 py-1 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40"
                    >
                      {circle}
                      <span className={labelClass}>{s.label}</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-1.5 px-1.5 py-1 select-none">
                      {circle}
                      <span className={labelClass}>{s.label}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        ) : view !== "flow" ? (
          <button
            type="button"
            onClick={() => onOpenView("flow")}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-[7px] text-[13px] font-medium text-tf-ink-2 hover:text-tf-ink hover:bg-tf-surface-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40"
          >
            <ArrowLeft size={15} strokeWidth={1.75} className="shrink-0" />
            Back
          </button>
        ) : (
          <div aria-hidden />
        )}

        {/* Right: Actions */}
        <div className="flex items-center gap-1.5">
          {backendStatus === "offline" && (
            <Pill tone="danger">
              <Dot />
              Offline
            </Pill>
          )}

          <button
            type="button"
            onClick={() => onOpenView("search")}
            aria-label="Search"
            title="Search"
            className={`w-8 h-8 rounded-[8px] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40 ${
              view === "search"
                ? "bg-tf-surface-2 text-tf-ink"
                : "text-tf-ink-2 hover:bg-tf-surface-2 hover:text-tf-ink"
            }`}
          >
            <Search size={17} strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={() => onOpenView("settings")}
            aria-label="Settings"
            title="Settings"
            className={`w-8 h-8 rounded-[8px] flex items-center justify-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40 ${
              view === "settings"
                ? "bg-tf-surface-2 text-tf-ink"
                : "text-tf-ink-2 hover:bg-tf-surface-2 hover:text-tf-ink"
            }`}
          >
            <Settings2 size={17} strokeWidth={1.75} />
          </button>

          <button
            type="button"
            onClick={toggleDarkMode}
            aria-label={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            title={darkMode ? "Switch to light mode" : "Switch to dark mode"}
            className="w-8 h-8 rounded-[8px] flex items-center justify-center text-tf-ink-2 hover:bg-tf-surface-2 hover:text-tf-ink transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={darkMode ? "dark" : "light"}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="flex items-center justify-center"
              >
                {darkMode ? <Sun size={17} strokeWidth={1.75} /> : <Moon size={17} strokeWidth={1.75} />}
              </motion.div>
            </AnimatePresence>
          </button>
        </div>
      </div>
    </header>
  );
}
