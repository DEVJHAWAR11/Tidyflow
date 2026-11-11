import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useTransform,
} from "motion/react";
import { ArrowLeft, ArrowRight, ArrowUp, Check, CornerUpLeft, FolderOpen, X } from "lucide-react";
import type { ClassifiedFile } from "../types";
import { FilePreview, FolderIcon } from "./icons";
import { ease } from "./ui";
import { formatBytes, prettyFolderName } from "../utils/folderVisuals";

type Decision = { fileId: string; kind: "place"; folder: string } | { fileId: string; kind: "leave" };

export interface SwipeReviewProps {
  /** The files to go through, in order; fixed for the session so placed files keep their spot. */
  files: ClassifiedFile[];
  folders: string[];
  newNames: Record<string, string>;
  onPlace: (fileId: string, folder: string) => void;
  onLeave: (fileId: string) => void;
  /** Reverse one earlier decision. */
  onUndo: (decision: Decision) => void;
  onClose: () => void;
}

const SWIPE_DISTANCE = 120;
const SWIPE_VELOCITY = 600;

function suggestionFor(f: ClassifiedFile, folders: string[]) {
  return f.category !== "Unknown" && folders.includes(f.category) ? f.category : null;
}

/** Go through the files to review one card at a time: right puts a file in its suggested folder, left leaves it. */
export function SwipeReview({ files, folders, newNames, onPlace, onLeave, onUndo, onClose }: SwipeReviewProps) {
  const [index, setIndex] = useState(0);
  const [history, setHistory] = useState<Decision[]>([]);
  // A keyboard or button decision flings the top card the same way a swipe would.
  const [fling, setFling] = useState<{ dir: "left" | "right" | "up"; folder?: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const current = files[index];
  const suggestion = current ? suggestionFor(current, folders) : null;
  const done = index >= files.length;

  const decide = useCallback(
    (dir: "left" | "right" | "up", folder?: string) => {
      if (!current) return;
      if (dir === "left") {
        onLeave(current.file_id);
        setHistory((h) => [...h, { fileId: current.file_id, kind: "leave" }]);
      } else {
        const target = folder ?? suggestion;
        if (!target) return;
        onPlace(current.file_id, target);
        setHistory((h) => [...h, { fileId: current.file_id, kind: "place", folder: target }]);
      }
      setFling(null);
      setChoosing(false);
      setIndex((i) => i + 1);
    },
    [current, suggestion, onLeave, onPlace]
  );

  const undo = useCallback(() => {
    const last = history[history.length - 1];
    if (!last) return;
    onUndo(last);
    setHistory((h) => h.slice(0, -1));
    setFling(null);
    setChoosing(false);
    setIndex((i) => Math.max(0, i - 1));
  }, [history, onUndo]);

  // A right swipe needs a suggestion; without one it opens the folder list instead.
  const accept = useCallback(() => {
    if (suggestion) setFling({ dir: "right" });
    else setChoosing(true);
  }, [suggestion]);

  useEffect(() => {
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (choosing) setChoosing(false);
        else onClose();
        return;
      }
      if ((e.key === "z" || e.key === "Z" || e.key === "Backspace") && !choosing) {
        e.preventDefault();
        undo();
        return;
      }
      if (done || fling || choosing) return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        accept();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        setFling({ dir: "left" });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setChoosing(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [accept, undo, onClose, choosing, done, fling]);

  const placed = history.filter((d) => d.kind === "place").length;
  const left = history.length - placed;

  return createPortal(
    <motion.div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/55 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2, ease }}
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Swipe through files to review"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[380px] flex flex-col items-center gap-5 outline-none"
      >
        {/* Progress */}
        <div className="w-full flex items-center justify-between text-white/80 text-[13px] tf-num">
          <span>{done ? "All done" : `${index + 1} of ${files.length}`}</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 -mr-1 rounded-full flex items-center justify-center hover:bg-white/10 text-white/80 hover:text-white cursor-pointer"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        <div className="w-full h-1 rounded-full bg-white/15 overflow-hidden -mt-3">
          <motion.div
            className="h-full bg-white rounded-full"
            animate={{ width: `${(Math.min(index, files.length) / Math.max(files.length, 1)) * 100}%` }}
            transition={{ duration: 0.3, ease }}
          />
        </div>

        {/* Card stack */}
        <div className="relative w-full h-[440px] mb-6">
          {done ? (
            <motion.div
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.25, ease }}
              className="absolute inset-0 rounded-[20px] bg-tf-surface border border-tf-border-strong shadow-[var(--shadow-tf-float)] flex flex-col items-center justify-center gap-3 p-8 text-center"
            >
              <div className="w-12 h-12 rounded-full bg-tf-success-soft text-tf-success flex items-center justify-center">
                <Check size={22} strokeWidth={2.25} />
              </div>
              <div className="text-[17px] font-semibold text-tf-ink">Review finished</div>
              <div className="text-[13.5px] text-tf-muted tf-num">
                {placed} put in folders · {left} left where they are
              </div>
              <button
                type="button"
                onClick={onClose}
                className="mt-3 h-9 px-5 rounded-full bg-tf-primary text-tf-on-primary text-[13.5px] font-medium hover:bg-tf-primary-hover cursor-pointer"
              >
                Back to review
              </button>
            </motion.div>
          ) : (
            <>
              {/* The next two files wait behind, slightly smaller, and move up as the top one goes. */}
              {[2, 1].map((depth) => {
                const f = files[index + depth];
                if (!f) return null;
                return (
                  <motion.div
                    key={f.file_id}
                    className="absolute inset-0"
                    initial={false}
                    animate={{ scale: 1 - depth * 0.05, y: depth * 24, opacity: depth === 2 ? 0.5 : 0.85 }}
                    transition={{ duration: 0.3, ease }}
                  >
                    <CardFace file={f} folders={folders} newName={newNames[f.file_id]} />
                  </motion.div>
                );
              })}
              <TopCard
                key={current.file_id}
                file={current}
                folders={folders}
                newName={newNames[current.file_id]}
                suggestion={suggestion}
                fling={fling}
                onSwipe={(dir) => (dir === "right" && !suggestion ? setChoosing(true) : setFling({ dir }))}
                onFlung={() => fling && decide(fling.dir, fling.folder)}
              />
              <AnimatePresence>
                {choosing && (
                  <FolderSheet
                    folders={folders}
                    suggestion={suggestion}
                    onPick={(folder) => {
                      setChoosing(false);
                      setFling({ dir: "up", folder });
                    }}
                    onCancel={() => setChoosing(false)}
                  />
                )}
              </AnimatePresence>
            </>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-center gap-4">
          <RoundButton label="Undo (Z)" size={44} disabled={!history.length} onClick={undo}>
            <CornerUpLeft size={18} strokeWidth={1.75} />
          </RoundButton>
          <RoundButton
            label="Leave where it is (←)"
            size={60}
            disabled={done || !!fling}
            onClick={() => setFling({ dir: "left" })}
          >
            <X size={26} strokeWidth={2} />
          </RoundButton>
          <RoundButton
            label={suggestion ? `Put in ${prettyFolderName(suggestion)} (→)` : "Choose a folder (→)"}
            size={60}
            tone="accept"
            disabled={done || !!fling}
            onClick={accept}
          >
            <Check size={26} strokeWidth={2.25} />
          </RoundButton>
          <RoundButton
            label="Choose another folder (↑)"
            size={44}
            disabled={done || !!fling}
            onClick={() => setChoosing(true)}
          >
            <FolderOpen size={18} strokeWidth={1.75} />
          </RoundButton>
        </div>

        <div className="flex items-center gap-4 text-[12px] text-white/60">
          <span className="flex items-center gap-1"><ArrowLeft size={12} /> leave</span>
          <span className="flex items-center gap-1"><ArrowRight size={12} /> suggested folder</span>
          <span className="flex items-center gap-1"><ArrowUp size={12} /> other folder</span>
          <span>Z undo</span>
        </div>
      </div>
    </motion.div>,
    document.body
  );
}

/** The draggable card on top of the stack. */
function TopCard({
  file,
  folders,
  newName,
  suggestion,
  fling,
  onSwipe,
  onFlung,
}: {
  file: ClassifiedFile;
  folders: string[];
  newName?: string;
  suggestion: string | null;
  fling: { dir: "left" | "right" | "up" } | null;
  onSwipe: (dir: "left" | "right") => void;
  onFlung: () => void;
}) {
  const reduce = useReducedMotion();
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-300, 0, 300], [-14, 0, 14]);
  const acceptOpacity = useTransform(x, [24, SWIPE_DISTANCE], [0, 1]);
  const leaveOpacity = useTransform(x, [-SWIPE_DISTANCE, -24], [1, 0]);

  useEffect(() => {
    if (!fling) return;
    const opts = { duration: reduce ? 0.12 : 0.32, ease: [0.4, 0, 1, 1] as const };
    const done = fling.dir === "up"
      ? animate(y, -window.innerHeight, opts)
      : animate(x, (fling.dir === "right" ? 1 : -1) * (window.innerWidth / 2 + 400), opts);
    done.then(onFlung);
    return () => done.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fling]);

  return (
    <motion.div
      className="absolute inset-0 cursor-grab active:cursor-grabbing touch-none"
      style={{ x, y, rotate }}
      initial={{ scale: 0.95, y: 24, opacity: 0.85 }}
      animate={{ scale: 1, y: 0, opacity: 1 }}
      transition={{ duration: 0.25, ease }}
      drag={fling ? false : "x"}
      dragMomentum={false}
      onDragEnd={(_, info) => {
        const right = info.offset.x > SWIPE_DISTANCE || info.velocity.x > SWIPE_VELOCITY;
        const left = info.offset.x < -SWIPE_DISTANCE || info.velocity.x < -SWIPE_VELOCITY;
        if (left) return onSwipe("left");
        if (right) onSwipe("right");
        // Not far enough, or a right swipe with no suggestion (that opens the folder list): spring back.
        if (!right || !suggestion) animate(x, 0, { type: "spring", stiffness: 520, damping: 34 });
      }}
    >
      <CardFace file={file} folders={folders} newName={newName} lifted />
      {/* Labels that fade in while dragging */}
      <motion.div
        style={{ opacity: acceptOpacity }}
        className="pointer-events-none absolute top-6 left-6 -rotate-12 rounded-[10px] border-[2.5px] border-tf-success px-3 py-1.5 text-[15px] font-bold uppercase tracking-wide text-tf-success bg-tf-surface/80"
      >
        {suggestion ? prettyFolderName(suggestion) : "Choose folder"}
      </motion.div>
      <motion.div
        style={{ opacity: leaveOpacity }}
        className="pointer-events-none absolute top-6 right-6 rotate-12 rounded-[10px] border-[2.5px] border-tf-muted px-3 py-1.5 text-[15px] font-bold uppercase tracking-wide text-tf-muted bg-tf-surface/80"
      >
        Leave
      </motion.div>
    </motion.div>
  );
}

/** What a file looks like on a card: preview, name, why the AI is unsure, and its suggested folder. */
function CardFace({
  file,
  folders,
  newName,
  lifted = false,
}: {
  file: ClassifiedFile;
  folders: string[];
  newName?: string;
  lifted?: boolean;
}) {
  const suggestion = suggestionFor(file, folders);
  const excerpt = (file.extracted_text || "").replace(/\s+/g, " ").trim().slice(0, 220);
  return (
    <div
      className={`h-full rounded-[20px] bg-tf-surface border border-tf-border-strong overflow-hidden flex flex-col select-none ${
        lifted ? "shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)]" : ""
      }`}
    >
      <div className="h-[170px] shrink-0 bg-tf-surface-2 border-b border-tf-border flex items-center justify-center">
        <FilePreview
          size={file.thumbnail_b64 ? 132 : 88}
          extension={file.extension}
          fileCategory={file.file_category}
          thumbnailB64={file.thumbnail_b64}
        />
      </div>
      <div className="flex-1 min-h-0 p-5 flex flex-col gap-2">
        <div className="text-[16px] font-semibold text-tf-ink leading-snug line-clamp-2 break-words">
          {file.filename}
        </div>
        {newName && (
          <div className="text-[12.5px] text-tf-brand-ink truncate">→ {newName}</div>
        )}
        <div className="text-[12.5px] text-tf-muted tf-num">
          {formatBytes(file.file_size_bytes)}
          {file.reason ? ` · ${file.reason}` : ""}
        </div>
        {excerpt && (
          <p className="text-[12.5px] leading-relaxed text-tf-faint line-clamp-3">{excerpt}</p>
        )}
        <div className="mt-auto pt-2 flex items-center gap-2.5">
          {suggestion ? (
            <>
              <FolderIcon name={suggestion} size={28} />
              <div className="min-w-0">
                <div className="text-[11px] text-tf-faint leading-none">Suggested</div>
                <div className="text-[13.5px] font-medium text-tf-ink truncate">{prettyFolderName(suggestion)}</div>
              </div>
            </>
          ) : (
            <div className="text-[13px] text-tf-muted">No suggestion, so pick a folder or leave it.</div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Folder list that slides up over the card. */
function FolderSheet({
  folders,
  suggestion,
  onPick,
  onCancel,
}: {
  folders: string[];
  suggestion: string | null;
  onPick: (folder: string) => void;
  onCancel: () => void;
}) {
  return (
    <motion.div
      className="absolute inset-0 z-10 rounded-[20px] bg-tf-surface border border-tf-border-strong shadow-[0_24px_60px_-12px_rgba(0,0,0,0.45)] flex flex-col overflow-hidden"
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 24 }}
      transition={{ duration: 0.2, ease }}
    >
      <div className="px-4 py-3 flex items-center justify-between border-b border-tf-border">
        <span className="text-[14px] font-semibold text-tf-ink">Put it in…</span>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="w-7 h-7 rounded-full flex items-center justify-center text-tf-faint hover:text-tf-ink hover:bg-tf-surface-2 cursor-pointer"
        >
          <X size={14} strokeWidth={2} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {folders.map((folder) => (
          <button
            key={folder}
            type="button"
            onClick={() => onPick(folder)}
            className="w-full h-10 px-2.5 rounded-[10px] hover:bg-tf-surface-2 flex items-center gap-2.5 text-[13.5px] text-tf-ink text-left cursor-pointer"
          >
            <FolderIcon name={folder} size={22} />
            <span className="truncate flex-1">{prettyFolderName(folder)}</span>
            {folder === suggestion && <span className="text-[11px] text-tf-faint">Suggested</span>}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

function RoundButton({
  children,
  label,
  size,
  tone = "plain",
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  label: string;
  size: number;
  tone?: "plain" | "accept";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { scale: 1.06 }}
      whileTap={disabled ? undefined : { scale: 0.92 }}
      transition={{ duration: 0.15, ease }}
      style={{ width: size, height: size }}
      className={`rounded-full flex items-center justify-center shadow-[0_8px_24px_-6px_rgba(0,0,0,0.5)] cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed ${
        tone === "accept"
          ? "bg-tf-success text-white"
          : "bg-tf-surface text-tf-ink border border-tf-border-strong"
      }`}
    >
      {children}
    </motion.button>
  );
}
