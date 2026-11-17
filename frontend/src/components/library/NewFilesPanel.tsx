// New since last time: TidyFlow reads the new files, suggests a folder for each, and you sort them.
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2, Sparkles } from "lucide-react";
import { Button, Card, Skeleton } from "../../flow/ui";
import { FilePreview } from "../../flow/icons";
import { formatBytes } from "../../utils/folderVisuals";
import { NameDialog } from "./LibraryDialogs";
import { newFiles, type SuggestedFile, type Suggestions } from "./libraryApi";

const UNSORTED = "";
const NEW_FOLDER = "__new__";
const pretty = (path: string) => path.split("/").filter(Boolean).join(" / ");

export function NewFilesPanel({
  paths,
  onDone,
  onBack,
}: {
  /** The new files to read and sort. */
  paths: string[];
  /** Called after sorting (or when there was nothing to sort) with what to tell the person. */
  onDone: (message: string | null, undoable: boolean) => void;
  onBack: () => void;
}) {
  const [result, setResult] = useState<Suggestions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [choice, setChoice] = useState<Record<number, string>>({});
  const [extraFolders, setExtraFolders] = useState<string[]>([]);
  const [askingFor, setAskingFor] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // React's dev double-run must not read the files twice
    started.current = true;
    newFiles
      .suggest(paths)
      .then((r) => {
        if (r.status === "cancelled") {
          onBack();
          return;
        }
        setResult(r);
        setChoice(Object.fromEntries(r.files.map((f) => [f.id, f.suggestion ?? UNSORTED])));
      })
      .catch((e: Error) => setError(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once for the files it was opened with
  }, []);

  const folders = useMemo(
    () => [...new Set([...(result?.folders ?? []), ...extraFolders])].sort((a, b) => a.localeCompare(b)),
    [result, extraFolders],
  );
  const files = result?.files ?? [];
  const toSort = files.filter((f) => choice[f.id]);

  const sort = async () => {
    setSaving(true);
    setError(null);
    try {
      const r = await newFiles.sort(
        files.map((f) => ({ id: f.id, folder: choice[f.id] || null, suggested: f.suggestion })),
      );
      const left = files.length - r.sorted;
      onDone(
        `Sorted ${r.sorted} new ${r.sorted === 1 ? "file" : "files"}${
          left ? `. ${left} ${left === 1 ? "is" : "are"} in Not sorted yet` : ""
        }`,
        r.sorted > 0,
      );
    } catch (e) {
      setError((e as Error).message);
      setSaving(false);
    }
  };

  const header = (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={onBack}
        aria-label="Back to the Library"
        className="w-8 h-8 rounded-[8px] flex items-center justify-center text-tf-ink-2 hover:text-tf-ink hover:bg-tf-surface-2 cursor-pointer"
      >
        <ArrowLeft size={17} strokeWidth={1.75} />
      </button>
      <div className="min-w-0">
        <h1 className="text-[24px] font-semibold tracking-[-0.02em] text-tf-ink">New since last time</h1>
        <p className="text-[13.5px] text-tf-muted">
          {result
            ? `${files.length} ${files.length === 1 ? "file" : "files"}. Check where each goes, then sort. Nothing on disk moves.`
            : `Reading ${paths.length} new ${paths.length === 1 ? "file" : "files"} to see where they belong…`}
        </p>
      </div>
    </div>
  );

  if (error && !result) {
    return (
      <div>
        {header}
        <Card className="mt-5 p-6 flex items-start gap-3 text-[13.5px]">
          <AlertTriangle size={17} strokeWidth={1.75} className="text-tf-danger shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="text-tf-ink">Couldn't read the new files.</p>
            <p className="mt-1 text-tf-muted">{error}</p>
          </div>
          <Button size="sm" onClick={onBack}>
            Back
          </Button>
        </Card>
      </div>
    );
  }

  if (!result) {
    return (
      <div>
        {header}
        <Card className="mt-5 overflow-hidden">
          <div className="px-4 h-11 flex items-center gap-2 border-b border-tf-border text-[13px] text-tf-muted">
            <Loader2 size={15} strokeWidth={2} className="animate-spin" />
            <span className="flex-1">Reading the files and matching them to your folders…</span>
            <Button
              size="sm"
              variant="ghost"
              disabled={cancelling}
              onClick={() => {
                setCancelling(true);
                newFiles.cancel().catch(() => setCancelling(false));
              }}
            >
              {cancelling ? "Stopping…" : "Stop"}
            </Button>
          </div>
          <div className="p-4 space-y-2">
            {Array.from({ length: Math.min(paths.length, 5) }, (_, i) => (
              <Skeleton key={i} className="h-11" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      {header}
      {!result.used_ai && files.length > 0 && (
        <p className="mt-3 flex items-center gap-2 text-[12.5px] text-tf-muted">
          <Sparkles size={14} strokeWidth={1.75} className="text-tf-faint" />
          AI is off, so suggestions only come from your folder rules. Pick a folder for the rest.
        </p>
      )}
      <Card className="mt-5 overflow-hidden">
        {files.length === 0 ? (
          <div className="px-6 py-12 text-center text-[13.5px] text-tf-muted">
            None of these files can be sorted. They may have been moved, or TidyFlow skips files like them.
          </div>
        ) : (
          <ul className="divide-y divide-tf-border">
            {files.map((f: SuggestedFile) => (
              <li key={f.id} className="px-4 py-2.5 flex items-center gap-3">
                <FilePreview extension={f.extension} thumbnailB64={f.thumbnail_b64 || undefined} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="truncate text-[13px] font-medium text-tf-ink" title={f.path}>
                    {f.name}
                  </div>
                  <div className="truncate text-[12px] text-tf-faint" title={f.reason}>
                    {[f.file_size_bytes ? formatBytes(f.file_size_bytes) : "", f.lives_in].filter(Boolean).join(" · ")}
                  </div>
                </div>
                <select
                  aria-label={`Folder for ${f.name}`}
                  value={choice[f.id] ?? UNSORTED}
                  onChange={(e) => {
                    if (e.target.value === NEW_FOLDER) setAskingFor(f.id);
                    else setChoice((c) => ({ ...c, [f.id]: e.target.value }));
                  }}
                  className={`w-[180px] sm:w-[220px] h-8 px-2 rounded-[7px] border bg-tf-surface text-[12.5px] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-tf-ink ${
                    choice[f.id] ? "border-tf-border-strong text-tf-ink" : "border-dashed border-tf-border-strong text-tf-faint"
                  }`}
                >
                  <option value={UNSORTED}>Leave in Not sorted yet</option>
                  {folders.map((path) => (
                    <option key={path} value={path}>
                      {pretty(path)}
                      {path === f.suggestion ? "  (suggested)" : ""}
                    </option>
                  ))}
                  <option value={NEW_FOLDER}>New folder…</option>
                </select>
              </li>
            ))}
          </ul>
        )}
      </Card>
      {error && <p className="mt-3 text-[13px] text-tf-danger">{error}</p>}
      <div className="mt-5 flex items-center justify-end gap-2">
        <Button variant="secondary" onClick={() => onDone(files.length ? "The new files are in Not sorted yet" : null, false)}>
          Not now
        </Button>
        <Button variant="primary" disabled={toSort.length === 0 || saving} onClick={sort}>
          {saving ? "Sorting…" : `Sort ${toSort.length} ${toSort.length === 1 ? "file" : "files"}`}
        </Button>
      </div>

      <NameDialog
        open={askingFor !== null}
        title="New folder"
        body="It's made when you sort. Use / to put it inside another folder, like Finance / Rent."
        initial=""
        confirmLabel="Use this folder"
        onCancel={() => setAskingFor(null)}
        onConfirm={(name) => {
          const path = name
            .split("/")
            .map((p) => p.trim())
            .filter(Boolean)
            .join("/");
          if (!path || askingFor === null) return;
          setExtraFolders((x) => [...x, path]);
          setChoice((c) => ({ ...c, [askingFor]: path }));
          setAskingFor(null);
        }}
      />
    </div>
  );
}
