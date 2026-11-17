// Dialogs for Library actions: typing a folder name, and choosing how to move files on disk.
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button, Card, ease } from "../../flow/ui";

function Modal({
  open,
  labelId,
  onCancel,
  children,
}: {
  open: boolean;
  labelId: string;
  onCancel: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-black/40"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15, ease }}
          onPointerDown={(e) => {
            if (e.target === e.currentTarget) onCancel();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelId}
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.18, ease }}
            className="w-full max-w-[440px]"
          >
            <Card className="p-5 shadow-[var(--shadow-tf-float)]">{children}</Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Ask for a name: a new folder, or a new name for one. */
export function NameDialog({
  open,
  title,
  body,
  initial,
  confirmLabel,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  initial: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!open) return;
    setValue(initial);
    // Select the name so typing replaces it, as in Finder.
    window.setTimeout(() => inputRef.current?.select(), 30);
  }, [open, initial]);

  const submit = () => {
    if (value.trim() && !busy) onConfirm(value.trim());
  };

  return (
    <Modal open={open} labelId="tf-name-title" onCancel={onCancel}>
      <h2 id="tf-name-title" className="text-[16px] font-semibold text-tf-ink">
        {title}
      </h2>
      {body && <p className="mt-1.5 text-[13.5px] leading-relaxed text-tf-muted">{body}</p>}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") submit();
        }}
        aria-label={title}
        maxLength={255}
        className="mt-4 w-full h-9 px-3 rounded-[8px] border border-tf-border-strong bg-tf-surface text-[14px] text-tf-ink outline-none focus:border-tf-ink-2 focus:ring-2 focus:ring-tf-brand/20"
      />
      {error && <p className="mt-2 text-[13px] text-tf-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" size="md" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="md" disabled={!value.trim() || busy} onClick={submit}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export type MoveChoice = "picked" | "whole";

/** Move on disk: the picked files to a folder, or the whole TidyFlow folder, making it real. */
export function MoveDialog({
  open,
  count,
  folderName,
  folderCount,
  busy,
  error,
  onChoose,
  onCancel,
}: {
  open: boolean;
  /** How many files are picked. */
  count: number;
  /** The TidyFlow folder they're in, when the whole folder can be made real. */
  folderName: string | null;
  folderCount: number;
  busy?: boolean;
  error?: string | null;
  onChoose: (choice: MoveChoice) => void;
  onCancel: () => void;
}) {
  const [choice, setChoice] = useState<MoveChoice>("picked");
  useEffect(() => {
    if (open) setChoice(count > 0 ? "picked" : "whole");
  }, [open, count]);

  const options: { id: MoveChoice; title: string; body: string; disabled: boolean }[] = [
    {
      id: "picked",
      title: count === 1 ? "Move the file I picked" : `Move the ${count} files I picked`,
      body:
        count === 1
          ? "Choose a folder on disk, and it moves there. It stays in its TidyFlow folders."
          : "Choose a folder on disk, and they move there. They stay in their TidyFlow folders.",
      disabled: count === 0,
    },
    ...(folderName
      ? [
          {
            id: "whole" as const,
            title: `Make ${folderName} a real folder`,
            body: `Choose where it goes. A folder called ${folderName} is made there and ${
              folderCount === 1 ? "its file moves" : folderCount === 2 ? "both its files move" : `all ${folderCount} of its files move`
            } into it.`,
            disabled: folderCount === 0,
          },
        ]
      : []),
  ];

  return (
    <Modal open={open} labelId="tf-move-title" onCancel={onCancel}>
      <h2 id="tf-move-title" className="text-[16px] font-semibold text-tf-ink">
        Move on disk
      </h2>
      <p className="mt-1.5 text-[13.5px] leading-relaxed text-tf-muted">
        This moves real files, so other apps see the change. You can undo it.
      </p>
      <div role="radiogroup" className="mt-4 space-y-2">
        {options.map((o) => (
          <label
            key={o.id}
            className={`flex gap-3 p-3 rounded-[8px] border transition-colors ${
              o.disabled
                ? "opacity-40 cursor-not-allowed border-tf-border"
                : choice === o.id
                ? "border-tf-ink cursor-pointer"
                : "border-tf-border-strong hover:bg-tf-surface-2 cursor-pointer"
            }`}
          >
            <input
              type="radio"
              name="tf-move-choice"
              className="mt-0.5 accent-[var(--color-tf-ink)]"
              checked={choice === o.id}
              disabled={o.disabled}
              onChange={() => setChoice(o.id)}
            />
            <span>
              <span className="block text-[14px] font-medium text-tf-ink">{o.title}</span>
              <span className="block mt-0.5 text-[13px] leading-[1.45] text-tf-muted">{o.body}</span>
            </span>
          </label>
        ))}
      </div>
      {error && <p className="mt-3 text-[13px] text-tf-danger">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="secondary" size="md" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" size="md" disabled={busy} onClick={() => onChoose(choice)}>
          {busy ? "Moving…" : "Choose folder…"}
        </Button>
      </div>
    </Modal>
  );
}
