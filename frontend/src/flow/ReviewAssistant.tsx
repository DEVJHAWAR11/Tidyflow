import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowUp, Check, CircleAlert, Undo2, WandSparkles } from "lucide-react";
import { Card, ease } from "./ui";
import { WizardStatus } from "../wizard/scenes";
import type { ClassifiedFile } from "../types";
import type { ReviewAiOutcome } from "./contracts";

const EXAMPLES = [
  "Move the course screenshots to Academic",
  "Put all invoices in a new folder called Bills",
  "Give the resumes clearer names",
  "Don't organize the empty files",
];

// What the wizard says while the request is running, in order.
const WORKING_LINES = ["Reading your files…", "Finding the right ones…", "Almost there…"];

interface ReviewAssistantProps {
  files: ClassifiedFile[];
  undecidedCount: number;
  hasDuplicates: boolean;
  onAsk: (command: string) => Promise<ReviewAiOutcome>;
  onUndo: () => void;
}

/** "Ask for a change" box on the review screen: plain-language bulk edits, applied as normal per-file choices. */
export function ReviewAssistant({ files, undecidedCount, hasDuplicates, onAsk, onUndo }: ReviewAssistantProps) {
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const [lineIndex, setLineIndex] = useState(0);
  const [outcome, setOutcome] = useState<ReviewAiOutcome | null>(null);
  const [undone, setUndone] = useState(false);
  const [exampleIndex, setExampleIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Cycle the placeholder through examples while the box is empty and idle.
  useEffect(() => {
    if (text || working) return;
    const t = window.setInterval(() => setExampleIndex((i) => (i + 1) % EXAMPLES.length), 3800);
    return () => window.clearInterval(t);
  }, [text, working]);

  useEffect(() => {
    if (!working) return;
    setLineIndex(0);
    const t = window.setInterval(() => setLineIndex((i) => Math.min(i + 1, WORKING_LINES.length - 1)), 2200);
    return () => window.clearInterval(t);
  }, [working]);

  // Starting points that fit what is actually on screen.
  const suggestions = useMemo(() => {
    const list: string[] = [];
    if (undecidedCount > 0) list.push("Put the files to review where they fit best");
    if (hasDuplicates) list.push("Leave out the duplicate copies");
    if (files.some((f) => /screenshot|^img[_-]|^\d+\.(jpe?g|png)$/i.test(f.filename))) {
      list.push("Give the screenshots clearer names");
    }
    if (list.length < 3) list.push("Give files with unclear names better ones");
    return list.slice(0, 3);
  }, [files, undecidedCount, hasDuplicates]);

  const submit = async (command: string) => {
    const cmd = command.trim();
    if (!cmd || working) return;
    setText(cmd);
    setWorking(true);
    setOutcome(null);
    setUndone(false);
    try {
      const result = await onAsk(cmd);
      setOutcome(result);
      if (!result.error && result.changedIds.length > 0) setText("");
    } catch {
      setOutcome({
        message: "",
        error: "Something went wrong. Nothing was changed.",
        changedIds: [],
        excludedIds: [],
        moved: 0,
        renamed: 0,
        left: 0,
        included: 0,
        newFolders: [],
      });
    } finally {
      setWorking(false);
    }
  };

  const changed = outcome && !outcome.error && outcome.changedIds.length + outcome.excludedIds.length > 0;
  const details = outcome
    ? [
        outcome.moved && `${outcome.moved} moved`,
        outcome.renamed && `${outcome.renamed} renamed`,
        outcome.left && `${outcome.left} left in place`,
        outcome.included && `${outcome.included} added back`,
        outcome.newFolders.length > 0 &&
          `new ${outcome.newFolders.length === 1 ? "folder" : "folders"}: ${outcome.newFolders.join(", ")}`,
      ].filter(Boolean)
    : [];

  return (
    <Card className="p-4 sm:p-5">
      <div className="flex items-center gap-2 text-[13px] font-medium text-tf-ink-2">
        <WandSparkles size={15} strokeWidth={1.75} className="shrink-0" />
        Ask for a change
      </div>

      <form
        className="mt-3 flex items-center gap-2 rounded-[10px] border border-tf-border-strong bg-tf-surface pl-3.5 pr-1.5 h-11 focus-within:border-tf-ink transition-colors"
        onSubmit={(e) => {
          e.preventDefault();
          submit(text);
        }}
      >
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setText("");
          }}
          disabled={working}
          placeholder={`e.g. ${EXAMPLES[exampleIndex]}`}
          aria-label="Ask for a change to where files go or what they're called"
          className="flex-1 min-w-0 bg-transparent text-[14px] text-tf-ink placeholder:text-tf-faint outline-none disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={working || !text.trim()}
          aria-label="Send"
          className="w-8 h-8 shrink-0 rounded-[8px] bg-tf-primary text-tf-on-primary flex items-center justify-center transition-opacity disabled:opacity-25 cursor-pointer disabled:cursor-default"
        >
          <ArrowUp size={16} strokeWidth={2} />
        </button>
      </form>

      {!working && (!outcome || undone) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => submit(s)}
              className="h-7 px-2.5 rounded-full border border-tf-border text-[12.5px] text-tf-ink-2 hover:text-tf-ink hover:border-tf-border-strong hover:bg-tf-surface-2 transition-colors cursor-pointer"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <WizardStatus
        active={working}
        label={WORKING_LINES[lineIndex]}
        doneLabel={changed ? "Done." : "Hmm…"}
        className="mt-4"
      />

      <AnimatePresence>
        {outcome && !working && (
          <motion.div
            key={outcome.message + outcome.error}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease, delay: 0.9 }}
            className="mt-3 flex items-start gap-2.5"
          >
            {outcome.error ? (
              <CircleAlert size={16} strokeWidth={1.75} className="text-tf-danger shrink-0 mt-[2px]" />
            ) : (
              <Check size={16} strokeWidth={2} className={`shrink-0 mt-[2px] ${changed ? "text-tf-ink" : "text-tf-faint"}`} />
            )}
            <div className="min-w-0 flex-1">
              <div className={`text-[13.5px] ${outcome.error ? "text-tf-danger" : "text-tf-ink"}`}>
                {undone ? "Undone. Everything is back the way it was." : outcome.error || outcome.message}
              </div>
              {!undone && details.length > 0 && (
                <div className="text-[12.5px] text-tf-muted tf-num mt-0.5">{details.join(" · ")}</div>
              )}
            </div>
            {changed && !undone && (
              <button
                type="button"
                onClick={() => {
                  onUndo();
                  setUndone(true);
                }}
                className="shrink-0 inline-flex items-center gap-1 text-[12.5px] font-medium text-tf-ink-2 hover:text-tf-ink cursor-pointer"
              >
                <Undo2 size={13} strokeWidth={1.75} />
                Undo
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Card>
  );
}
