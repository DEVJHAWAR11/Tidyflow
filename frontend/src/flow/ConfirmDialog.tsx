import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Button, Card, ease } from "./ui";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}

/** Small modal asking the user to confirm an action that discards work. */
export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel,
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
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
            aria-labelledby="tf-confirm-title"
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.18, ease }}
            className="w-full max-w-[420px]"
          >
            <Card className="p-5 shadow-[var(--shadow-tf-float)]">
              <h2 id="tf-confirm-title" className="text-[16px] font-semibold text-tf-ink">
                {title}
              </h2>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-tf-muted">{body}</p>
              <div className="mt-5 flex justify-end gap-2">
                <Button ref={cancelRef} variant="secondary" size="md" onClick={onCancel}>
                  {cancelLabel}
                </Button>
                <Button
                  variant="primary"
                  size="md"
                  onClick={onConfirm}
                  className={tone === "danger" ? "!bg-tf-danger hover:!bg-tf-danger/90 !text-white !shadow-none" : ""}
                >
                  {confirmLabel}
                </Button>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
