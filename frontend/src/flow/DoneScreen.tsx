import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FolderOpen, Undo2, ArrowRight, CheckCircle2, AlertTriangle, Loader2 } from "lucide-react";
import { Screen, Button, Card, ease } from "./ui";
import { FolderIcon } from "./icons";
import { folderLabel, prettyFolderName } from "../utils/folderVisuals";
import { WizardFlight } from "../wizard/scenes";
import type { DoneScreenProps } from "./contracts";

export function DoneScreen({
  result,
  onOpenFolder,
  onUndo,
  undoState,
  undoMessage,
  onTidyAnother,
}: DoneScreenProps) {
  const isUndone = undoState === "done";
  // The wizard swoops through once; the check appears as it passes.
  const markRef = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);
  const [undoFlight, setUndoFlight] = useState(0);
  useEffect(() => {
    if (undoState === "working") setUndoFlight((n) => n + 1);
  }, [undoState]);
  const folderCountLabel = result.folderCount === 1 ? "1 folder" : `${result.folderCount} folders`;
  const actionPrefix = result.action === "moved" ? "Moved into " : "Copied into ";

  return (
    <Screen className="max-w-[460px] mx-auto pt-[10vh] pb-16 px-4 text-center">
      <WizardFlight play={1} anchor={markRef} onMidpoint={() => setRevealed(true)} />
      <WizardFlight play={undoFlight} direction="back" anchor={markRef} />

      {/* Success Mark */}
      <div ref={markRef} className="w-[52px] h-[52px] mx-auto">
        {revealed && (
          <motion.div
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 22 }}
            className="w-[52px] h-[52px] rounded-full bg-tf-success-soft flex items-center justify-center select-none"
          >
            <svg
              width={24}
              height={24}
              viewBox="0 0 24 24"
              fill="none"
              className="text-tf-success"
              aria-hidden
            >
              <motion.path
                d="M6 12.5l4 4 8-9"
                fill="none"
                stroke="currentColor"
                strokeWidth={2.25}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.45, delay: 0.1, ease }}
              />
            </svg>
          </motion.div>
        )}
      </div>

      {/* Title */}
      <h1 className="mt-5 text-[24px] font-semibold tracking-[-0.02em] text-tf-ink tf-num">
        {isUndone
          ? "Changes undone"
          : `${result.count} ${result.count === 1 ? "file organized" : "files organized"}`}
      </h1>

      {/* Subtitles (hidden when undone) */}
      {!isUndone && (
        <>
          <p className="mt-1 text-[14px] text-tf-muted">
            {actionPrefix}
            {folderCountLabel} in{" "}
            <span className="font-medium text-tf-ink-2" title={result.outputDir}>
              {folderLabel(result.outputDir)}
            </span>
          </p>
          <p className="mt-1 text-[13px] text-tf-faint">
            {result.action === "moved" ? "Originals were moved." : "Your originals are untouched."}
          </p>
        </>
      )}

      {/* Folders Summary */}
      {!isUndone && result.folders && result.folders.length > 0 && (
        <Card className="mt-6 text-left divide-y divide-tf-border overflow-hidden">
          {result.folders.slice(0, 6).map((f) => (
            <div key={f.name} className="h-11 px-4 flex items-center gap-3">
              <FolderIcon name={f.name} size={28} />
              <span className="text-[13.5px] font-medium text-tf-ink flex-1 truncate">
                {prettyFolderName(f.name)}
              </span>
              <span className="text-[12.5px] text-tf-muted tf-num shrink-0">
                {f.count}
              </span>
            </div>
          ))}
          {result.folders.length > 6 && (
            <div className="h-10 px-4 flex items-center text-[12.5px] text-tf-muted">
              + {result.folders.length - 6} more{" "}
              {result.folders.length - 6 === 1 ? "folder" : "folders"}
            </div>
          )}
        </Card>
      )}

      {/* Action Buttons */}
      {!isUndone && (
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button
            variant="primary"
            size="md"
            icon={<FolderOpen size={15} strokeWidth={1.75} />}
            onClick={onOpenFolder}
          >
            Open folder
          </Button>

          <Button
            variant="secondary"
            size="md"
            icon={
              undoState === "working" ? (
                <Loader2 size={14} strokeWidth={2} className="animate-spin" />
              ) : (
                <Undo2 size={15} strokeWidth={1.75} />
              )
            }
            disabled={undoState === "working"}
            onClick={onUndo}
          >
            {undoState === "working" ? "Undoing…" : "Undo"}
          </Button>
        </div>
      )}

      {/* Undo Message */}
      <AnimatePresence>
        {undoMessage && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.18, ease }}
            className="mt-3 flex items-center justify-center gap-1.5 text-[13px] text-tf-muted"
          >
            {undoState === "done" ? (
              <CheckCircle2 size={15} strokeWidth={1.75} className="text-tf-success shrink-0" />
            ) : undoState === "error" ? (
              <AlertTriangle size={15} strokeWidth={1.75} className="text-tf-danger shrink-0" />
            ) : null}
            <span>{undoMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Organize Another Folder */}
      <div className="mt-8 flex justify-center">
        <Button
          variant="ghost"
          size="sm"
          iconRight={<ArrowRight size={14} strokeWidth={1.75} />}
          onClick={onTidyAnother}
        >
          Organize another folder
        </Button>
      </div>
    </Screen>
  );
}
