// The Library: the TidyFlow folders that sorting fills, and the files in each, wherever they live on disk.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  ClipboardPaste,
  Copy,
  FolderInput,
  FolderPlus,
  FolderSearch,
  FolderMinus,
  HardDrive,
  Inbox,
  Library,
  Loader2,
  MoreHorizontal,
  Pencil,
  RotateCw,
  Scissors,
  Search,
  Sparkles,
  Trash2,
  Undo2,
} from "lucide-react";
import { Button, Card, Pill, Screen, Skeleton, ease } from "../../flow/ui";
import { ConfirmDialog } from "../../flow/ConfirmDialog";
import { DirectoryPickerModal } from "../DirectoryPickerModal";
import { FolderGlyph } from "./FolderGlyph";
import { FileTable, type RowClick } from "./FileTable";
import { FolderTree, folderTrail, indexFolders } from "./FolderTree";
import { MoveDialog, NameDialog, type MoveChoice } from "./LibraryDialogs";
import { NewFilesPanel } from "./NewFilesPanel";
import type { SearchScope } from "../SearchView";
import {
  browseForFolder,
  fetchFolderFiles,
  fetchFolders,
  learnedRules,
  libraryActions,
  newFiles,
  sinceLabel,
  type FolderKey,
  type LibraryFile,
  type LibraryFolder,
  type LibraryFolders,
  type NewCheck,
  type RuleSuggestion,
} from "./libraryApi";

const PAGE = 50;
// How many new files one "Sort them" reads; the rest wait for the next round.
const NEW_BATCH = 200;
// The check whose banner was put off with "Later" (until the next check), kept while the app is open.
let laterFor: string | null = null;
const SELECTED_KEY = "tidyflow_library_folder";
const IS_MAC = /mac/i.test(navigator.userAgent);
const MOD = IS_MAC ? "⌘" : "Ctrl+";

function loadSelected(): FolderKey | null {
  try {
    const raw = localStorage.getItem(SELECTED_KEY);
    if (raw === "unsorted") return "unsorted";
    const n = raw ? Number(raw) : NaN;
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

function saveSelected(key: FolderKey) {
  try {
    localStorage.setItem(SELECTED_KEY, String(key));
  } catch {
    // Remembering the folder is only a convenience.
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString()} ${n === 1 ? one : many}`;

interface Clipboard {
  op: "cut" | "copy";
  ids: number[];
  from: FolderKey;
}

type Dialog =
  | { kind: "new-folder"; parentId: number | null; parentName: string | null }
  | { kind: "rename-folder"; folder: LibraryFolder }
  | { kind: "delete-folder"; folder: LibraryFolder; fileCount: number }
  | { kind: "trash"; ids: number[]; names: string[]; missingOnly: boolean }
  | { kind: "move" }
  | { kind: "paste-real"; clip: Clipboard; folder: LibraryFolder; count: number }
  | { kind: "make-real"; folder: LibraryFolder; parentDir: string; fileCount: number };

interface Toast {
  id: number;
  text: string;
  tone: "ok" | "error";
  undo: boolean;
}

/** A small menu that opens under its button and closes on a click elsewhere or Escape. */
function Menu({ label, items }: { label: string; items: { label: string; icon: React.ReactNode; onClick: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-8 h-8 rounded-[8px] flex items-center justify-center text-tf-ink-2 hover:text-tf-ink hover:bg-tf-surface-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40"
      >
        <MoreHorizontal size={17} strokeWidth={1.75} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease }}
            className="absolute right-0 top-9 z-30 min-w-[220px] p-1 rounded-[10px] bg-tf-surface border border-tf-border-strong shadow-[var(--shadow-tf-float)]"
          >
            {items.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onClick();
                }}
                className={`w-full flex items-center gap-2.5 h-8 px-2.5 rounded-[7px] text-left text-[13px] cursor-pointer hover:bg-tf-surface-2 ${
                  item.danger ? "text-tf-danger" : "text-tf-ink"
                }`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ToolButton({
  label,
  short,
  icon,
  onClick,
  disabled,
  shortcut,
  danger,
}: {
  label: string;
  /** A shorter label for the toolbar; the full one is the tooltip. */
  short?: string;
  icon: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  shortcut?: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 h-8 px-2 rounded-[7px] text-[13px] font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-35 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40 ${
        danger
          ? "text-tf-danger hover:bg-tf-danger-soft disabled:hover:bg-transparent"
          : "text-tf-ink-2 hover:text-tf-ink hover:bg-tf-surface-2 disabled:hover:bg-transparent"
      }`}
    >
      {icon}
      <span className="hidden xl:inline">{short ?? label}</span>
    </button>
  );
}

/** Search box in a folder's header: Enter opens Search scoped to that folder. */
function FolderSearchBox({ placeholder, onSearch }: { placeholder: string; onSearch: (query: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <form
      role="search"
      onSubmit={(e) => {
        e.preventDefault();
        if (value.trim()) onSearch(value.trim());
      }}
      className="relative hidden sm:flex items-center"
    >
      <Search size={14} strokeWidth={1.75} className="absolute left-2.5 text-tf-faint pointer-events-none" />
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-[200px] lg:w-[240px] h-8 pl-8 pr-2.5 rounded-[8px] border border-tf-border-strong bg-tf-surface text-[13px] text-tf-ink placeholder:text-tf-faint outline-none focus:border-tf-ink-2 focus:ring-2 focus:ring-tf-brand/20"
      />
    </form>
  );
}

export function LibraryView({
  onOpenTidyUp,
  onOpenPath,
  onSearch,
  onNewCount,
}: {
  onOpenTidyUp: () => void;
  onOpenPath: (path: string, reveal?: boolean) => void;
  /** Open Search inside a folder (with its subfolders) or among the files in none. */
  onSearch: (scope: SearchScope) => void;
  /** How many new files are waiting, for the Library tab. */
  onNewCount?: (n: number) => void;
}) {
  const [lib, setLib] = useState<LibraryFolders | null>(null);
  const [libError, setLibError] = useState<string | null>(null);
  const [selected, setSelected] = useState<FolderKey | null>(loadSelected);
  const [files, setFiles] = useState<LibraryFile[]>([]);
  const [total, setTotal] = useState(0);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [anchor, setAnchor] = useState<number | null>(null);
  const [clipboard, setClipboard] = useState<Clipboard | null>(null);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const [lastAction, setLastAction] = useState<string | null>(null);
  // When the system folder picker isn't there, TidyFlow's own picker asks instead.
  const [fallbackPicker, setFallbackPicker] = useState<{ prompt: string; resolve: (p: string | null) => void } | null>(null);
  // New since last time: the last check, and the files being sorted now.
  const [newCheck, setNewCheck] = useState<NewCheck | null>(null);
  const [checking, setChecking] = useState(false);
  const [later, setLater] = useState<string | null>(laterFor);
  const [sortingNew, setSortingNew] = useState<string[] | null>(null);
  // A rule TidyFlow could learn from where files were put.
  const [ruleOffers, setRuleOffers] = useState<RuleSuggestion[]>([]);

  const loadFolders = useCallback(() => {
    setLibError(null);
    return fetchFolders()
      .then((fresh) => {
        setLib(fresh);
        return fresh;
      })
      .catch((e: Error) => {
        setLibError(e.message);
        return null;
      });
  }, []);

  const loadRuleOffers = useCallback(() => {
    learnedRules
      .list()
      .then((r) => setRuleOffers(r.suggestions))
      .catch(() => setRuleOffers([]));
  }, []);

  const loadHistory = useCallback(() => {
    libraryActions
      .history()
      .then((h) => setLastAction(h.actions[0]?.label ?? null))
      .catch(() => setLastAction(null));
  }, []);

  const showNew = useCallback(
    (check: NewCheck) => {
      setNewCheck(check);
      onNewCount?.(check.total_new);
    },
    [onNewCount],
  );

  useEffect(() => {
    loadFolders();
    loadHistory();
    loadRuleOffers();
    // The check that ran when the app opened (or one now, if it hasn't run yet).
    newFiles.status().then(showNew).catch(() => setNewCheck(null));
  }, [loadFolders, loadHistory, loadRuleOffers, showNew]);

  const index = useMemo(() => indexFolders(lib?.folders || []), [lib]);

  // A remembered folder that no longer exists falls back to the first folder, or "Not sorted yet".
  const current: FolderKey | null = useMemo(() => {
    if (!lib) return null;
    if (selected === "unsorted" || (typeof selected === "number" && index.byId.has(selected))) return selected;
    return index.children.get(null)?.[0]?.id ?? "unsorted";
  }, [lib, selected, index]);

  const select = (key: FolderKey) => {
    setSelected(key);
    saveSelected(key);
  };

  // Only the newest request for files counts; an older one answering late is ignored.
  const filesRequest = useRef(0);
  const loadFiles = useCallback((key: FolderKey, offset: number, limit = PAGE) => {
    const request = ++filesRequest.current;
    const latest = () => request === filesRequest.current;
    setFilesLoading(true);
    setFilesError(null);
    return fetchFolderFiles(key, offset, limit)
      .then((page) => {
        if (!latest()) return;
        setTotal(page.total);
        setFiles((prev) => (offset === 0 ? page.files : [...prev, ...page.files]));
      })
      .catch((e: Error) => {
        if (latest()) setFilesError(e.message);
      })
      .finally(() => {
        if (latest()) setFilesLoading(false);
      });
  }, []);

  useEffect(() => {
    if (current === null) return;
    setFiles([]);
    setTotal(0);
    setPicked(new Set());
    setAnchor(null);
    setRenamingId(null);
    loadFiles(current, 0);
  }, [current, loadFiles]);

  /** After an action: fresh folders, the same number of files as were showing, and the Undo label. */
  const refresh = useCallback(async () => {
    loadHistory();
    loadRuleOffers();
    const fresh = await loadFolders();
    // A folder that was just deleted is left to the switch to another folder.
    const stillThere = current === "unsorted" || fresh?.folders.some((f) => f.id === current);
    if (current !== null && stillThere) await loadFiles(current, 0, Math.max(PAGE, files.length));
  }, [loadHistory, loadRuleOffers, loadFolders, loadFiles, current, files.length]);

  // Picked files that are gone after a refresh stop being picked.
  useEffect(() => {
    setPicked((prev) => {
      const ids = new Set(files.map((f) => f.id));
      const next = new Set([...prev].filter((id) => ids.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [files]);

  const toastTimer = useRef<number | undefined>(undefined);
  const say = (text: string, tone: Toast["tone"] = "ok", undo = false) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, tone, undo });
    toastTimer.current = window.setTimeout(() => setToast(null), tone === "error" ? 8000 : 6000);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  /** Run an action, then refresh and say what happened (with Undo when it can be undone). */
  const act = async (run: () => Promise<string | null>, opts: { undoable?: boolean } = {}) => {
    setBusy(true);
    setDialogError(null);
    try {
      const message = await run();
      setDialog(null);
      await refresh();
      if (message) say(message, "ok", opts.undoable ?? true);
      return true;
    } catch (e) {
      const text = (e as Error).message;
      if (dialog) setDialogError(text);
      else say(text, "error");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const checkAgain = async () => {
    setChecking(true);
    try {
      const check = await newFiles.check();
      showNew(check);
      if (check.followed) await refresh();
      const found = check.total_new ? `Found ${plural(check.total_new, "new file")}` : "No new files";
      say(
        check.followed
          ? `${found}. Kept up with ${plural(check.followed, "file")} you renamed or moved`
          : `${found} since you last looked`,
      );
    } catch (e) {
      say((e as Error).message, "error");
    } finally {
      setChecking(false);
    }
  };

  const finishSortingNew = async (message: string | null, undoable: boolean) => {
    setSortingNew(null);
    await refresh();
    newFiles.status().then(showNew).catch(() => undefined);
    if (message) say(message, "ok", undoable);
  };

  const acceptRule = (offer: RuleSuggestion) =>
    act(async () => {
      await learnedRules.add(offer.folder_id, offer.contains);
      return `Files with “${offer.contains}” in the name will be suggested for ${offer.folder.split("/").pop()}`;
    });

  const declineRule = (offer: RuleSuggestion) => {
    setRuleOffers((offers) => offers.filter((o) => o !== offer));
    learnedRules.dismiss(offer.folder_id, offer.contains).catch(() => undefined);
  };

  const pickDiskFolder = (prompt: string, initial?: string | null): Promise<string | null> =>
    browseForFolder(prompt, initial).catch(
      () => new Promise<string | null>((resolve) => setFallbackPicker({ prompt, resolve })),
    );

  const folder = typeof current === "number" ? index.byId.get(current) : undefined;
  const pickedFiles = files.filter((f) => picked.has(f.id));
  const pickedIds = pickedFiles.map((f) => f.id);
  const cutIds = useMemo(
    () => new Set(clipboard?.op === "cut" && clipboard.from === current ? clipboard.ids : []),
    [clipboard, current],
  );

  // --- Selection ---

  const onRowClick = (id: number, click: RowClick) => {
    if (renamingId !== null) return;
    const order = files.map((f) => f.id);
    if (click.shift && anchor !== null && order.includes(anchor)) {
      const [a, b] = [order.indexOf(anchor), order.indexOf(id)].sort((x, y) => x - y);
      setPicked(new Set(order.slice(a, b + 1)));
      return;
    }
    if (click.meta) {
      setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setPicked(new Set([id]));
    }
    setAnchor(id);
  };

  // --- Actions ---

  const copyOrCut = (op: Clipboard["op"]) => {
    if (!pickedIds.length || current === null) return;
    setClipboard({ op, ids: pickedIds, from: current });
    say(
      `${op === "cut" ? "Cut" : "Copied"} ${plural(pickedIds.length, "file")}. Open a folder and paste (${MOD}V).`,
      "ok",
      false,
    );
  };

  const paste = async () => {
    if (!clipboard || current === null) return;
    const clip = clipboard;
    const from = typeof clip.from === "number" ? clip.from : null;
    if (current === "unsorted") {
      if (clip.op === "cut" && from !== null) {
        const fromName = index.byId.get(from)?.name ?? "its folder";
        const ok = await act(async () => {
          await libraryActions.remove(clip.ids, from);
          return `Took ${plural(clip.ids.length, "file")} out of ${fromName}`;
        });
        if (ok) setClipboard(null);
      } else {
        say("Files here aren't in any folder. Open a folder to paste into it.", "error");
      }
      return;
    }
    const target = index.byId.get(current);
    if (!target) return;
    if (clip.from === current) {
      say(`Those files are already in ${target.name}.`, "error");
      return;
    }
    setBusy(true);
    try {
      const result = await libraryActions.paste(clip.ids, current, clip.op, from);
      if (result.needs_disk_move) {
        setDialogError(null);
        setDialog({ kind: "paste-real", clip, folder: target, count: result.count });
        return;
      }
      if (clip.op === "cut") setClipboard(null);
      await refresh();
      say(`${clip.op === "cut" ? "Moved" : "Added"} ${plural(clip.ids.length, "file")} to ${target.name}`, "ok", true);
    } catch (e) {
      say((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  const removeFromFolder = () => {
    if (!folder || !pickedIds.length) return;
    act(async () => {
      await libraryActions.remove(pickedIds, folder.id);
      return `Took ${plural(pickedIds.length, "file")} out of ${folder.name}`;
    });
  };

  const startRename = () => {
    const only = pickedFiles.length === 1 ? pickedFiles[0] : null;
    if (only && !only.missing) setRenamingId(only.id);
  };

  const renameFile = (id: number, name: string) => {
    setRenamingId(null);
    act(async () => {
      await libraryActions.renameFile(id, name);
      return `Renamed to ${name}`;
    });
  };

  const askTrash = () => {
    if (!pickedFiles.length) return;
    setDialogError(null);
    setDialog({
      kind: "trash",
      ids: pickedIds,
      names: pickedFiles.map((f) => f.name),
      missingOnly: pickedFiles.every((f) => f.missing),
    });
  };

  const undo = () =>
    act(async () => {
      const result = await libraryActions.undo();
      return `Undone: ${result.undone}`;
    }, { undoable: false });

  const chooseMove = async (choice: MoveChoice) => {
    if (choice === "picked") {
      const dest = await pickDiskFolder("Choose where the files go");
      if (!dest) return;
      act(async () => {
        const r = await libraryActions.moveOnDisk(pickedIds, dest);
        const unreal = r.unreal_folders.length
          ? ` ${plural(r.unreal_folders.length, "folder")} now ${r.unreal_folders.length === 1 ? "is" : "are"} only in TidyFlow.`
          : "";
        return `Moved ${plural(r.moved, "file")} to ${dest.split(/[\\/]/).pop()}.${unreal}`;
      });
    } else if (folder) {
      const parent = await pickDiskFolder(`Choose where the ${folder.name} folder goes`);
      if (!parent) return;
      act(async () => {
        const r = await libraryActions.makeReal(folder.id, parent);
        return `${folder.name} is a real folder now. ${plural(r.moved, "file")} moved into it.`;
      });
    }
  };

  const askMakeReal = async () => {
    if (!folder) return;
    const parent = await pickDiskFolder(`Choose where the ${folder.name} folder goes`);
    if (!parent) return;
    setDialogError(null);
    setDialog({ kind: "make-real", folder, parentDir: parent, fileCount: folder.count });
  };

  // --- Keyboard ---

  const keyState = useRef({ copyOrCut, paste, startRename, askTrash, undo, removeFromFolder });
  keyState.current = { copyOrCut, paste, startRename, askTrash, undo, removeFromFolder };
  const blocked = dialog !== null || renamingId !== null || fallbackPicker !== null || sortingNew !== null;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (blocked || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName))) return;
      const mod = e.metaKey || e.ctrlKey;
      const k = keyState.current;
      const key = e.key.toLowerCase();
      if (mod && key === "a") {
        e.preventDefault();
        setPicked(new Set(files.map((f) => f.id)));
      } else if (mod && key === "c") k.copyOrCut("copy");
      else if (mod && key === "x") k.copyOrCut("cut");
      else if (mod && key === "v") {
        e.preventDefault();
        k.paste();
      } else if (mod && key === "z" && !e.shiftKey) {
        e.preventDefault();
        k.undo();
      } else if (e.key === "Enter" && !mod) {
        e.preventDefault();
        k.startRename();
      } else if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        k.askTrash();
      } else if (e.key === "Escape") setPicked(new Set());
      else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && files.length) {
        e.preventDefault();
        const order = files.map((f) => f.id);
        const at = anchor !== null ? order.indexOf(anchor) : -1;
        const next = order[Math.min(order.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))];
        setPicked(new Set([next]));
        setAnchor(next);
        document.querySelector(`[data-file-id="${next}"]`)?.scrollIntoView({ block: "nearest" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [blocked, files, anchor]);

  // --- Render ---

  if (libError) {
    return (
      <Screen className="max-w-md mx-auto pt-[12vh] text-center">
        <AlertTriangle size={22} strokeWidth={1.75} className="mx-auto text-tf-danger" />
        <h1 className="mt-3 text-[18px] font-semibold text-tf-ink">Couldn't open your Library</h1>
        <p className="mt-1 text-[14px] text-tf-muted">{libError}</p>
        <Button className="mt-5" icon={<RotateCw size={14} strokeWidth={1.75} />} onClick={loadFolders}>
          Try again
        </Button>
      </Screen>
    );
  }

  if (!lib || current === null) {
    return (
      <Screen className="grid md:grid-cols-[232px_minmax(0,1fr)] gap-8">
        <div className="space-y-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-7" />
          ))}
        </div>
        <Skeleton className="h-64" />
      </Screen>
    );
  }

  if (sortingNew) {
    return (
      <Screen className="max-w-[880px] mx-auto">
        <NewFilesPanel
          paths={sortingNew}
          onDone={finishSortingNew}
          onBack={() => finishSortingNew(null, false)}
        />
      </Screen>
    );
  }

  if (lib.total_files === 0 && lib.folders.length === 0) {
    return (
      <Screen className="max-w-[440px] mx-auto pt-[12vh] text-center">
        <div className="w-12 h-12 mx-auto rounded-full bg-tf-surface-3 flex items-center justify-center">
          <Library size={22} strokeWidth={1.75} className="text-tf-ink-2" />
        </div>
        <h1 className="mt-4 text-[22px] font-semibold tracking-[-0.02em] text-tf-ink">Your Library is empty</h1>
        <p className="mt-2 text-[14px] leading-[1.55] text-tf-muted">
          Tidy up a folder and its files land here, sorted into TidyFlow folders. Nothing on disk moves unless you ask.
        </p>
        <Button
          variant="primary"
          className="mt-6"
          iconRight={<ArrowRight size={15} strokeWidth={1.75} />}
          onClick={onOpenTidyUp}
        >
          Tidy up a folder
        </Button>
      </Screen>
    );
  }

  const trail = folder ? folderTrail(index, folder.id) : [];
  const subfolders = folder ? index.children.get(folder.id) || [] : [];
  const empty = !filesLoading && !filesError && files.length === 0 && subfolders.length === 0;
  const onlyPicked = pickedFiles.length === 1 ? pickedFiles[0] : null;
  const subtreeCount = folder ? index.total.get(folder.id) ?? folder.count : 0;

  const folderMenu = folder
    ? [
        { label: "Rename folder", icon: <Pencil size={15} strokeWidth={1.75} />, onClick: () => setDialog({ kind: "rename-folder", folder }) },
        {
          label: "New folder inside",
          icon: <FolderPlus size={15} strokeWidth={1.75} />,
          onClick: () => setDialog({ kind: "new-folder", parentId: folder.id, parentName: folder.name }),
        },
        folder.is_real && folder.disk_path
          ? {
              label: IS_MAC ? "Show in Finder" : "Show on disk",
              icon: <FolderSearch size={15} strokeWidth={1.75} />,
              onClick: () => onOpenPath(folder.disk_path!, false),
            }
          : { label: "Make it a real folder…", icon: <FolderInput size={15} strokeWidth={1.75} />, onClick: askMakeReal },
        {
          label: "Delete folder",
          icon: <Trash2 size={15} strokeWidth={1.75} />,
          danger: true,
          onClick: () => setDialog({ kind: "delete-folder", folder, fileCount: subtreeCount }),
        },
      ]
    : [];

  const waiting = newCheck && newCheck.total_new > 0 && later !== newCheck.checked_at ? newCheck : null;
  const waitingRoots = waiting ? waiting.roots.filter((r) => waiting.new.some((f) => f.root === r.path)) : [];
  const since = waitingRoots.length === 1 ? sinceLabel(waitingRoots[0].last_checked_at) : null;
  const checkedAt = newCheck ? new Date(newCheck.checked_at) : null;

  return (
    <Screen className="grid md:grid-cols-[232px_minmax(0,1fr)] gap-6 md:gap-8 items-start">
      {/* New since last time */}
      {waiting && (
        <div
          role="status"
          className="md:col-span-2 flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3 rounded-[12px] border border-tf-link/30 bg-tf-link/8"
        >
          <span className="w-9 h-9 shrink-0 rounded-[9px] bg-tf-surface flex items-center justify-center text-tf-link">
            <Inbox size={18} strokeWidth={1.75} />
          </span>
          <div className="flex-1 min-w-[220px]">
            <p className="text-[14px] font-medium text-tf-ink">
              {plural(waiting.total_new, "new file")} in{" "}
              {waitingRoots.length === 1 ? (
                <span title={waitingRoots[0].path}>{waitingRoots[0].label.split(/[\\/]/).filter(Boolean).pop()}</span>
              ) : (
                plural(waitingRoots.length, "scanned folder")
              )}
              {since && ` since you last looked${since === "earlier today" || since === "yesterday" ? " " : " on "}${since}`}
            </p>
            <p className="text-[12.5px] text-tf-muted">
              TidyFlow suggests a folder for each and you check them. Nothing on disk moves.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                laterFor = waiting.checked_at;
                setLater(waiting.checked_at);
              }}
            >
              Later
            </Button>
            <Button size="sm" variant="secondary" disabled={checking} onClick={checkAgain}>
              {checking ? "Checking…" : "Check again"}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => setSortingNew(waiting.new.slice(0, NEW_BATCH).map((f) => f.path))}
            >
              {waiting.total_new > NEW_BATCH ? `Sort the newest ${NEW_BATCH}` : "Sort them"}
            </Button>
          </div>
        </div>
      )}

      <aside className="md:sticky md:top-[76px]">
        <FolderTree index={index} unsortedCount={lib.unsorted_count} selected={current} onSelect={select} />
        <button
          type="button"
          onClick={() => setDialog({ kind: "new-folder", parentId: null, parentName: null })}
          className="mt-3 w-full flex items-center gap-2 h-8 px-2 rounded-[7px] text-[13px] text-tf-muted hover:text-tf-ink hover:bg-tf-surface-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40"
        >
          <FolderPlus size={15} strokeWidth={1.75} />
          New folder
        </button>

        {newCheck && newCheck.roots.length > 0 && (
          <div className="mt-5 pt-4 border-t border-tf-border">
            <div className="pl-2 flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-tf-faint">Scanned on disk</span>
              <button
                type="button"
                onClick={checkAgain}
                disabled={checking}
                className="h-6 px-2 rounded-[6px] flex items-center gap-1.5 text-[12px] font-medium text-tf-link hover:bg-tf-surface-2 cursor-pointer disabled:cursor-default disabled:text-tf-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40"
              >
                {checking && <Loader2 size={12} strokeWidth={2} className="animate-spin" />}
                {checking ? "Checking" : "Check"}
              </button>
            </div>
            <ul className="mt-1.5">
              {newCheck.roots.map((r) => (
                <li
                  key={r.path}
                  title={r.path}
                  className="px-2 h-7 flex items-center gap-2 text-[12.5px] text-tf-ink-2 min-w-0"
                >
                  <HardDrive size={14} strokeWidth={1.75} className="shrink-0 text-tf-faint" />
                  <span className="truncate">{r.label}</span>
                  {!r.exists && <span className="ml-auto shrink-0 text-[11.5px] text-tf-warn">Not found</span>}
                </li>
              ))}
            </ul>
            <p className="px-2 mt-1 text-[11.5px] leading-[1.45] text-tf-faint">
              {checkedAt && !Number.isNaN(checkedAt.getTime())
                ? `Checked at ${checkedAt.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}. `
                : ""}
              TidyFlow looks for new files when it opens or when you ask.
            </p>
          </div>
        )}
      </aside>

      <section className="min-w-0">
        {/* Where you are */}
        <div className="flex items-center gap-1 text-[12.5px] text-tf-faint min-w-0">
          <span>Library</span>
          {(folder ? trail : [{ id: -1, name: "Not sorted yet" }]).map((f, i, all) => (
            <span key={f.id} className="flex items-center gap-1 min-w-0">
              <ChevronRight size={12} strokeWidth={2} className="shrink-0" />
              {i < all.length - 1 ? (
                <button
                  type="button"
                  onClick={() => select(f.id)}
                  className="truncate hover:text-tf-ink cursor-pointer focus-visible:outline-none focus-visible:underline"
                >
                  {f.name}
                </button>
              ) : (
                <span className="truncate text-tf-muted">{f.name}</span>
              )}
            </span>
          ))}
        </div>

        <div className="mt-2 flex items-start gap-3">
          <div className="flex-1 min-w-0 flex flex-wrap items-center gap-x-3 gap-y-2">
            {folder && <FolderGlyph real={folder.is_real} size={26} />}
            <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-tf-ink truncate">
              {folder ? folder.name : "Not sorted yet"}
            </h1>
            {folder && <Pill tone="neutral">{folder.is_real ? "Real folder" : "Only in TidyFlow"}</Pill>}
          </div>
          <FolderSearchBox
            key={String(current)}
            placeholder={folder ? `Search in ${folder.name}` : "Search files not sorted yet"}
            onSearch={(query) => onSearch({ folder: current, query })}
          />
          {folder && <Menu label="Folder actions" items={folderMenu} />}
        </div>
        <p className="mt-1.5 text-[13.5px] text-tf-muted">
          {folder ? (
            <>
              {plural(total, "file")}
              {subfolders.length > 0 && ` · ${plural(subfolders.length, "folder")}`}
              {" · "}
              {folder.is_real && folder.disk_path ? (
                <>
                  On disk at{" "}
                  <button
                    type="button"
                    onClick={() => onOpenPath(folder.disk_path!, false)}
                    className="inline text-left break-all text-tf-ink-2 hover:text-tf-ink underline-offset-2 hover:underline cursor-pointer"
                    title={`Open ${folder.disk_path}`}
                  >
                    {folder.disk_label || folder.disk_path}
                    <FolderSearch size={13} strokeWidth={1.75} className="inline ml-1 -mt-0.5" />
                  </button>
                </>
              ) : (
                "The files stay where they are on disk."
              )}
            </>
          ) : (
            `${plural(total, "file")} TidyFlow has seen but hasn't put in a folder.`
          )}
        </p>

        {/* A rule TidyFlow could learn */}
        {ruleOffers[0] && (
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2.5 px-3.5 py-2.5 rounded-[10px] border border-tf-border bg-tf-surface-2">
            <Sparkles size={16} strokeWidth={1.75} className="shrink-0 text-tf-link" />
            <div className="flex-1 min-w-[240px] text-[13px] leading-[1.45]">
              <p className="text-tf-ink" title={ruleOffers[0].examples.join("\n")}>
                You put {plural(ruleOffers[0].corrections, "file")} with{" "}
                <span className="font-semibold">“{ruleOffers[0].contains}”</span> in the name in{" "}
                {ruleOffers[0].folder.split("/").join(" / ")}.
              </p>
              <p className="text-tf-muted">
                Suggest {ruleOffers[0].folder.split("/").pop()} for files like that from now on?
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => declineRule(ruleOffers[0])}>
                No thanks
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => acceptRule(ruleOffers[0])}>
                Yes, suggest it
              </Button>
            </div>
          </div>
        )}

        <Card className="mt-5 overflow-hidden">
          {/* Toolbar: what you can do with the files you picked */}
          <div className="flex items-center gap-0.5 px-2 h-11 border-b border-tf-border overflow-hidden">
            {picked.size > 0 ? (
              <>
                <span className="px-2 text-[13px] font-medium text-tf-ink tf-num whitespace-nowrap">
                  {plural(picked.size, "file")} picked
                </span>
                <span className="w-px h-5 bg-tf-border-strong mx-1" />
                <ToolButton label="Cut" shortcut={`${MOD}X`} icon={<Scissors size={15} strokeWidth={1.75} />} onClick={() => copyOrCut("cut")} />
                <ToolButton label="Copy" shortcut={`${MOD}C`} icon={<Copy size={15} strokeWidth={1.75} />} onClick={() => copyOrCut("copy")} />
                <ToolButton
                  label="Rename"
                  shortcut="↩"
                  icon={<Pencil size={15} strokeWidth={1.75} />}
                  onClick={startRename}
                  disabled={!onlyPicked || onlyPicked.missing}
                />
                {folder && (
                  <ToolButton
                    label="Remove from folder"
                    short="Remove"
                    icon={<FolderMinus size={15} strokeWidth={1.75} />}
                    onClick={removeFromFolder}
                  />
                )}
                <ToolButton
                  label="Move on disk…"
                  icon={<FolderInput size={15} strokeWidth={1.75} />}
                  onClick={() => {
                    setDialogError(null);
                    setDialog({ kind: "move" });
                  }}
                  disabled={pickedFiles.some((f) => f.missing)}
                />
                <ToolButton
                  label={pickedFiles.every((f) => f.missing) ? "Forget" : "Move to Trash"}
                  short={pickedFiles.every((f) => f.missing) ? "Forget" : "Trash"}
                  shortcut="⌫"
                  icon={<Trash2 size={15} strokeWidth={1.75} />}
                  onClick={askTrash}
                  danger
                />
              </>
            ) : (
              <>
                <ToolButton
                  label="New folder"
                  icon={<FolderPlus size={15} strokeWidth={1.75} />}
                  onClick={() =>
                    setDialog(
                      folder
                        ? { kind: "new-folder", parentId: folder.id, parentName: folder.name }
                        : { kind: "new-folder", parentId: null, parentName: null },
                    )
                  }
                />
                <ToolButton
                  label={clipboard ? `Paste ${plural(clipboard.ids.length, "file")}` : "Paste"}
                  shortcut={`${MOD}V`}
                  icon={<ClipboardPaste size={15} strokeWidth={1.75} />}
                  onClick={paste}
                  disabled={!clipboard || busy}
                />
                {folder && !folder.is_real && (
                  <ToolButton
                    label="Move on disk…"
                    icon={<FolderInput size={15} strokeWidth={1.75} />}
                    onClick={() => {
                      setDialogError(null);
                      setDialog({ kind: "move" });
                    }}
                    disabled={folder.count === 0}
                  />
                )}
                <span className="hidden sm:inline px-2 text-[12.5px] text-tf-faint truncate">
                  Click a file to pick it. {MOD}-click or Shift-click picks more.
                </span>
              </>
            )}
            <span className="flex-1" />
            {busy && <Loader2 size={15} strokeWidth={2} className="animate-spin text-tf-faint mx-1" />}
            <ToolButton
              label="Undo"
              shortcut={`${MOD}Z`}
              icon={<Undo2 size={15} strokeWidth={1.75} />}
              onClick={undo}
              disabled={!lastAction || busy}
            />
          </div>

          {empty ? (
            <div className="px-6 py-14 text-center text-[13.5px] text-tf-muted">
              {folder ? "This folder is empty." : "Every file is in a folder."}
            </div>
          ) : (
            <FileTable
              subfolders={subfolders}
              subfolderTotals={index.total}
              files={files}
              selected={picked}
              cutIds={cutIds}
              renamingId={renamingId}
              onSelect={onRowClick}
              onRename={renameFile}
              onRenameCancel={() => setRenamingId(null)}
              onOpenFolder={select}
              onOpenPath={onOpenPath}
            />
          )}
          {filesLoading && files.length === 0 && (
            <div className="p-4 space-y-2">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-10" />
              ))}
            </div>
          )}
          {filesError && (
            <div className="px-4 py-4 flex items-center gap-3 border-t border-tf-border text-[13px] text-tf-danger">
              <AlertTriangle size={15} strokeWidth={1.75} className="shrink-0" />
              <span className="flex-1">{filesError}</span>
              <Button size="sm" onClick={() => loadFiles(current, files.length)}>
                Try again
              </Button>
            </div>
          )}
        </Card>

        {files.length < total && !filesError && (
          <div className="mt-4 flex justify-center">
            <Button
              size="sm"
              disabled={filesLoading}
              icon={filesLoading ? <Loader2 size={14} strokeWidth={2} className="animate-spin" /> : undefined}
              onClick={() => loadFiles(current, files.length)}
            >
              Show more ({(total - files.length).toLocaleString()} left)
            </Button>
          </div>
        )}

        <p className="mt-4 text-[12px] text-tf-faint text-center tf-num">
          {MOD}C copy · {MOD}X cut · {MOD}V paste · ↩ rename · ⌫ Trash · {MOD}Z undo
        </p>
      </section>

      {/* Dialogs */}
      <NameDialog
        open={dialog?.kind === "new-folder"}
        title={dialog?.kind === "new-folder" && dialog.parentName ? `New folder in ${dialog.parentName}` : "New folder"}
        body="Only in TidyFlow. Nothing is made on disk."
        initial="New folder"
        confirmLabel="Make folder"
        busy={busy}
        error={dialogError}
        onCancel={() => setDialog(null)}
        onConfirm={(name) =>
          dialog?.kind === "new-folder" &&
          act(async () => {
            const made = await libraryActions.newFolder(name, dialog.parentId);
            select(made.id);
            return `Made ${made.name}`;
          })
        }
      />
      <NameDialog
        open={dialog?.kind === "rename-folder"}
        title="Rename folder"
        body={
          dialog?.kind === "rename-folder" && dialog.folder.is_real
            ? "This is a real folder, so it is renamed on disk too."
            : undefined
        }
        initial={dialog?.kind === "rename-folder" ? dialog.folder.name : ""}
        confirmLabel="Rename"
        busy={busy}
        error={dialogError}
        onCancel={() => setDialog(null)}
        onConfirm={(name) =>
          dialog?.kind === "rename-folder" &&
          act(async () => {
            await libraryActions.renameFolder(dialog.folder.id, name);
            return `Renamed ${dialog.folder.name} to ${name}`;
          })
        }
      />
      <MoveDialog
        open={dialog?.kind === "move"}
        count={pickedIds.length}
        folderName={folder && !folder.is_real ? folder.name : null}
        folderCount={folder?.count ?? 0}
        busy={busy}
        error={dialogError}
        onCancel={() => setDialog(null)}
        onChoose={chooseMove}
      />
      <ConfirmDialog
        open={dialog?.kind === "delete-folder"}
        title={dialog?.kind === "delete-folder" ? `Delete ${dialog.folder.name}?` : ""}
        body={
          dialog?.kind === "delete-folder"
            ? `${
                dialog.fileCount
                  ? `${dialog.fileCount === 1 ? "Its file goes" : `Its ${plural(dialog.fileCount, "file")} go`} back to Not sorted yet. `
                  : ""
              }${
                dialog.folder.is_real ? "The folder on disk stays as it is." : "Nothing on disk changes."
              } You can undo this.`
            : ""
        }
        confirmLabel="Delete folder"
        tone="danger"
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          dialog?.kind === "delete-folder" &&
          act(async () => {
            await libraryActions.deleteFolder(dialog.folder.id);
            return `Deleted ${dialog.folder.name}`;
          })
        }
      />
      <ConfirmDialog
        open={dialog?.kind === "trash"}
        title={
          dialog?.kind === "trash"
            ? dialog.missingOnly
              ? `Forget ${dialog.ids.length === 1 ? dialog.names[0] : plural(dialog.ids.length, "file")}?`
              : `Move ${dialog.ids.length === 1 ? dialog.names[0] : plural(dialog.ids.length, "file")} to the Trash?`
            : ""
        }
        body={
          dialog?.kind === "trash"
            ? dialog.missingOnly
              ? "TidyFlow can't find them on disk, so it just stops listing them."
              : `They leave every TidyFlow folder. Undo can't bring them back, but you can put them back from the Trash${
                  IS_MAC ? " in Finder" : ""
                }.`
            : ""
        }
        confirmLabel={dialog?.kind === "trash" && dialog.missingOnly ? "Forget" : "Move to Trash"}
        tone="danger"
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          dialog?.kind === "trash" &&
          act(
            async () => {
              const r = await libraryActions.trash(dialog.ids);
              return [r.trashed && `Moved ${plural(r.trashed, "file")} to the Trash`, r.forgotten && `forgot ${plural(r.forgotten, "file")}`]
                .filter(Boolean)
                .join(", ");
            },
            { undoable: false },
          )
        }
      />
      <ConfirmDialog
        open={dialog?.kind === "paste-real"}
        title={dialog?.kind === "paste-real" ? `${dialog.folder.name} is a real folder` : ""}
        body={
          dialog?.kind === "paste-real"
            ? `Pasting here moves ${plural(dialog.count, "file")} into ${dialog.folder.disk_label || dialog.folder.disk_path} on disk, so the folder stays real. You can undo it.`
            : ""
        }
        confirmLabel="Move on disk"
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind !== "paste-real" || !dialog.folder.disk_path) return;
          const { clip, folder: target } = dialog;
          act(async () => {
            const r = await libraryActions.moveOnDisk(clip.ids, target.disk_path!, {
              toFolderId: target.id,
              fromFolderId: typeof clip.from === "number" ? clip.from : null,
              op: clip.op,
            });
            if (clip.op === "cut") setClipboard(null);
            return `Moved ${plural(r.moved, "file")} into ${target.name} on disk`;
          });
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === "make-real"}
        title={dialog?.kind === "make-real" ? `Make ${dialog.folder.name} a real folder?` : ""}
        body={
          dialog?.kind === "make-real"
            ? `A folder called ${dialog.folder.name} is made in ${dialog.parentDir}${
                dialog.fileCount ? ` and its ${plural(dialog.fileCount, "file")} move into it` : ""
              }. Other apps will see it. You can undo this.`
            : ""
        }
        confirmLabel="Make it real"
        onCancel={() => setDialog(null)}
        onConfirm={() =>
          dialog?.kind === "make-real" &&
          act(async () => {
            const r = await libraryActions.makeReal(dialog.folder.id, dialog.parentDir);
            return `${dialog.folder.name} is a real folder now${r.moved ? `. ${plural(r.moved, "file")} moved into it` : ""}.`;
          })
        }
      />
      <DirectoryPickerModal
        isOpen={fallbackPicker !== null}
        title={fallbackPicker?.prompt}
        onClose={() => {
          fallbackPicker?.resolve(null);
          setFallbackPicker(null);
        }}
        onSelect={(path) => {
          fallbackPicker?.resolve(path);
          setFallbackPicker(null);
        }}
      />

      {/* What just happened, with Undo */}
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            role="status"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18, ease }}
            className="fixed z-40 bottom-5 left-1/2 -translate-x-1/2 max-w-[calc(100vw-32px)] flex items-center gap-3 pl-4 pr-2 h-11 rounded-[10px] bg-tf-primary text-tf-on-primary shadow-[var(--shadow-tf-float)] text-[13px]"
          >
            {toast.tone === "error" && <AlertTriangle size={15} strokeWidth={1.75} className="shrink-0" />}
            <span className="truncate">{toast.text}</span>
            {toast.undo ? (
              <button
                type="button"
                onClick={() => {
                  setToast(null);
                  undo();
                }}
                className="h-8 px-3 rounded-[7px] font-semibold hover:bg-white/15 cursor-pointer"
              >
                Undo
              </button>
            ) : (
              <span className="w-2" />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </Screen>
  );
}
