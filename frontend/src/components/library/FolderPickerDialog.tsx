// Choose a TidyFlow folder, or make a new one, e.g. to add search results to it.
import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { FolderPlus, Loader2 } from "lucide-react";
import { Button, Card, ease } from "../../flow/ui";
import { FolderGlyph } from "./FolderGlyph";
import { indexFolders } from "./FolderTree";
import { fetchFolders, libraryActions, type LibraryFolder } from "./libraryApi";

export function FolderPickerDialog({
  open,
  title,
  body,
  confirmLabel,
  busy,
  error,
  onPick,
  onCancel,
}: {
  open: boolean;
  title: string;
  body?: string;
  confirmLabel: string;
  busy?: boolean;
  error?: string | null;
  onPick: (folder: LibraryFolder) => void;
  onCancel: () => void;
}) {
  const [folders, setFolders] = useState<LibraryFolder[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [making, setMaking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChosen(null);
    setNewName(null);
    setLoadError(null);
    fetchFolders()
      .then((lib) => setFolders(lib.folders))
      .catch((e: Error) => setLoadError(e.message));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  // The tree, flattened in order with each folder's depth.
  const rows = useMemo(() => {
    const index = indexFolders(folders || []);
    const out: { folder: LibraryFolder; depth: number }[] = [];
    const walk = (parent: number | null, depth: number) =>
      (index.children.get(parent) || []).forEach((f) => {
        out.push({ folder: f, depth });
        walk(f.id, depth + 1);
      });
    walk(null, 0);
    return out;
  }, [folders]);

  const makeFolder = async () => {
    const name = newName?.trim();
    if (!name) return;
    setMaking(true);
    setLoadError(null);
    try {
      const made = await libraryActions.newFolder(name, null);
      setFolders((prev) => [...(prev || []), made]);
      setChosen(made.id);
      setNewName(null);
    } catch (e) {
      setLoadError((e as Error).message);
    } finally {
      setMaking(false);
    }
  };

  const picked = folders?.find((f) => f.id === chosen) || null;

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
            aria-labelledby="tf-folder-picker-title"
            initial={{ opacity: 0, scale: 0.97, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.97, y: 6 }}
            transition={{ duration: 0.18, ease }}
            className="w-full max-w-[440px]"
          >
            <Card className="p-5 shadow-[var(--shadow-tf-float)]">
              <h2 id="tf-folder-picker-title" className="text-[16px] font-semibold text-tf-ink">
                {title}
              </h2>
              {body && <p className="mt-1.5 text-[13.5px] leading-relaxed text-tf-muted">{body}</p>}

              <div
                role="listbox"
                aria-label="TidyFlow folders"
                className="mt-4 max-h-[280px] overflow-y-auto rounded-[8px] border border-tf-border-strong p-1"
              >
                {folders === null && !loadError && (
                  <div className="h-20 flex items-center justify-center text-tf-faint">
                    <Loader2 size={16} strokeWidth={2} className="animate-spin" />
                  </div>
                )}
                {folders !== null && rows.length === 0 && (
                  <p className="px-3 py-4 text-[13px] text-tf-muted">No folders yet. Make one below.</p>
                )}
                {rows.map(({ folder, depth }) => (
                  <button
                    key={folder.id}
                    type="button"
                    role="option"
                    aria-selected={chosen === folder.id}
                    onClick={() => setChosen(folder.id)}
                    onDoubleClick={() => onPick(folder)}
                    style={{ paddingLeft: 10 + depth * 16 }}
                    className={`w-full flex items-center gap-2 h-8 pr-2 rounded-[6px] text-left text-[13px] cursor-pointer ${
                      chosen === folder.id ? "bg-tf-link/12 text-tf-ink font-medium" : "text-tf-ink-2 hover:bg-tf-surface-2"
                    }`}
                  >
                    <FolderGlyph real={folder.is_real} size={16} />
                    <span className="flex-1 truncate">{folder.name}</span>
                    {folder.is_real && <span className="text-[11.5px] text-tf-faint">real folder</span>}
                  </button>
                ))}
              </div>

              {newName === null ? (
                <button
                  type="button"
                  onClick={() => setNewName("")}
                  className="mt-2 inline-flex items-center gap-1.5 h-8 px-2 rounded-[7px] text-[13px] text-tf-muted hover:text-tf-ink hover:bg-tf-surface-2 cursor-pointer"
                >
                  <FolderPlus size={15} strokeWidth={1.75} />
                  New folder
                </button>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <input
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") makeFolder();
                      if (e.key === "Escape") setNewName(null);
                    }}
                    placeholder="Folder name"
                    aria-label="New folder name"
                    maxLength={255}
                    className="flex-1 h-8 px-2.5 rounded-[7px] border border-tf-border-strong bg-tf-surface text-[13px] text-tf-ink outline-none focus:border-tf-ink-2"
                  />
                  <Button size="sm" disabled={!newName.trim() || making} onClick={makeFolder}>
                    Make
                  </Button>
                </div>
              )}

              {(error || loadError) && <p className="mt-3 text-[13px] text-tf-danger">{error || loadError}</p>}
              <div className="mt-5 flex justify-end gap-2">
                <Button variant="secondary" size="md" onClick={onCancel}>
                  Cancel
                </Button>
                <Button variant="primary" size="md" disabled={!picked || busy} onClick={() => picked && onPick(picked)}>
                  {busy ? "Adding…" : confirmLabel}
                </Button>
              </div>
            </Card>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
