import { motion, AnimatePresence } from "motion/react";
import { Check, Loader2, AlertTriangle, CircleSlash } from "lucide-react";
import { Screen, Button, Card, ease } from "./ui";
import { SortingWizard } from "../wizard/scenes";
import { folderLabel } from "../utils/folderVisuals";
import type { SortingScreenProps } from "./contracts";

const CHECKLIST_STAGES = [
  { id: "scan", label: "Find files" },
  { id: "extract", label: "Read contents" },
  { id: "classify", label: "Choose folders" },
  { id: "finalize", label: "Finish" },
];

function getStageTitle(stage: string): string {
  switch (stage) {
    case "scan":
      return "Finding files";
    case "extract":
      return "Reading contents";
    case "classify":
      return "Choosing folders";
    case "finalize":
      return "Finishing up";
    default:
      return "Starting";
  }
}

export function SortingScreen({
  inputFolder,
  stage,
  logs,
  isCancelling,
  onCancel,
  error,
  onRetry,
  onBack,
}: SortingScreenProps) {
  // Error state
  if (error) {
    return (
      <Screen className="max-w-[420px] mx-auto pt-[12vh] pb-16 px-4 text-center">
        <div className="w-11 h-11 rounded-[12px] bg-tf-surface-2 border border-tf-border flex items-center justify-center mx-auto mb-4">
          <AlertTriangle size={20} strokeWidth={1.75} className="text-tf-warn" />
        </div>
        <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-tf-ink mb-1.5">
          Sorting didn't finish
        </h2>
        <p className="text-[13.5px] text-tf-muted mb-4">
          Nothing in your folder was changed.
        </p>
        <div className="rounded-[10px] bg-tf-surface-2 border border-tf-border px-3 py-2 font-mono text-[12px] text-tf-ink-2 text-left break-words mb-6 max-h-36 overflow-y-auto">
          {error}
        </div>
        <div className="flex items-center justify-center gap-3">
          <Button variant="primary" size="md" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="secondary" size="md" onClick={onBack}>
            Back
          </Button>
        </div>
      </Screen>
    );
  }

  // Cancelled state
  if (stage === "Cancelled") {
    return (
      <Screen className="max-w-[420px] mx-auto pt-[12vh] pb-16 px-4 text-center">
        <div className="w-11 h-11 rounded-[12px] bg-tf-surface-2 border border-tf-border flex items-center justify-center mx-auto mb-4">
          <CircleSlash size={20} strokeWidth={1.75} className="text-tf-muted" />
        </div>
        <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-tf-ink mb-1.5">
          Sorting stopped
        </h2>
        <p className="text-[13.5px] text-tf-muted mb-6">
          Nothing in your folder was changed.
        </p>
        <div className="flex items-center justify-center">
          <Button variant="secondary" size="md" onClick={onBack}>
            Back to plan
          </Button>
        </div>
      </Screen>
    );
  }

  const title = getStageTitle(stage);
  const stageOrder = ["scan", "extract", "classify", "finalize"];
  const activeIdx = stageOrder.indexOf(stage);
  const currentIdx = activeIdx >= 0 ? activeIdx : 0;

  const rawLatestLog = logs.length > 0 ? logs[logs.length - 1] : "";
  const cleanLog = rawLatestLog.replace(/^[>✓✗]\s*/, "").trim();

  return (
    <Screen className="max-w-[420px] mx-auto pt-[12vh] pb-16 px-4 text-center">
      {/* The wizard sorts while the user waits */}
      <SortingWizard stage={stage} />

      {/* Title */}
      <div className="mt-6 min-h-[28px] flex items-center justify-center">
        <AnimatePresence mode="wait" initial={false}>
          <motion.h2
            key={title}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease }}
            className="text-[19px] font-semibold tracking-[-0.015em] text-tf-ink"
          >
            {title}
          </motion.h2>
        </AnimatePresence>
      </div>

      {/* Subtitle */}
      <p className="mt-1 text-[13.5px] text-tf-muted truncate" title={inputFolder}>
        Sorting {folderLabel(inputFolder)}
      </p>

      {/* Stage Checklist */}
      <Card className="mt-7 text-left divide-y divide-tf-border overflow-hidden">
        {CHECKLIST_STAGES.map((s, idx) => {
          const isDone = idx < currentIdx;
          const isCurrent = idx === currentIdx;

          return (
            <div key={s.id} className="h-10 px-4 flex items-center gap-3">
              {isDone ? (
                <div className="w-4 h-4 rounded-full bg-tf-primary flex items-center justify-center shrink-0">
                  <Check size={10} strokeWidth={3.5} className="text-tf-on-primary" />
                </div>
              ) : isCurrent ? (
                <Loader2 size={16} strokeWidth={2} className="animate-spin text-tf-brand shrink-0" />
              ) : (
                <div className="w-4 h-4 rounded-full border-[1.5px] border-tf-border-strong shrink-0" />
              )}
              <span
                className={`text-[13.5px] ${
                  isDone
                    ? "text-tf-ink-2"
                    : isCurrent
                    ? "text-tf-ink font-medium"
                    : "text-tf-faint"
                }`}
              >
                {s.label}
              </span>
            </div>
          );
        })}
      </Card>

      {/* Activity Line */}
      <div className="mt-4 h-5 flex items-center justify-center overflow-hidden">
        <AnimatePresence mode="wait">
          {cleanLog ? (
            <motion.p
              key={cleanLog}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease }}
              className="text-[12.5px] text-tf-muted truncate px-2"
              title={cleanLog}
            >
              {cleanLog}
            </motion.p>
          ) : (
            <div className="h-5" />
          )}
        </AnimatePresence>
      </div>

      {/* Cancel Action */}
      <div className="mt-5 flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          disabled={isCancelling}
          onClick={onCancel}
        >
          {isCancelling ? "Stopping…" : "Cancel"}
        </Button>
      </div>
    </Screen>
  );
}
