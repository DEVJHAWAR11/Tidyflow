// The files in one Library folder: what each is, what's inside, and where it really lives on disk.
import { useEffect, useRef, useState } from "react";
import { ExternalLink, FolderSearch, FileQuestion } from "lucide-react";
import { FilePreview } from "../../flow/icons";
import { formatBytes } from "../../utils/folderVisuals";
import { FolderGlyph } from "./FolderGlyph";
import type { LibraryFile, LibraryFolder } from "./libraryApi";

const REVEAL_LABEL = /mac/i.test(navigator.userAgent) ? "Show in Finder" : "Show in folder";
const COLS = "lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1.5fr)_minmax(0,1fr)_68px]";

const iconButton =
  "w-7 h-7 rounded-[6px] flex items-center justify-center text-tf-muted hover:text-tf-ink hover:bg-tf-surface-3 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40";

/** The name being typed for a file, with the part before the extension selected, as in Finder. */
function RenameInput({
  name,
  onSubmit,
  onCancel,
}: {
  name: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(name);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    const dot = name.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : name.length);
  }, [name]);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    if (save && value.trim() && value.trim() !== name) onSubmit(value.trim());
    else onCancel();
  };
  return (
    <input
      ref={ref}
      value={value}
      aria-label={`New name for ${name}`}
      maxLength={255}
      onChange={(e) => setValue(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      className="w-full h-7 -my-0.5 px-1.5 rounded-[5px] border border-tf-ink-2 bg-tf-surface text-[13px] font-medium text-tf-ink outline-none ring-2 ring-tf-brand/20"
    />
  );
}

export interface RowClick {
  meta: boolean;
  shift: boolean;
}

export function FileTable({
  subfolders,
  subfolderTotals,
  files,
  selected,
  cutIds,
  renamingId,
  onSelect,
  onRename,
  onRenameCancel,
  onOpenFolder,
  onOpenPath,
}: {
  subfolders: LibraryFolder[];
  subfolderTotals: Map<number, number>;
  files: LibraryFile[];
  selected: Set<number>;
  /** Files on the clipboard to be cut: shown faded until pasted. */
  cutIds: Set<number>;
  renamingId: number | null;
  onSelect: (id: number, click: RowClick) => void;
  onRename: (id: number, name: string) => void;
  onRenameCancel: () => void;
  onOpenFolder: (id: number) => void;
  onOpenPath: (path: string, reveal?: boolean) => void;
}) {
  return (
    <div role="grid" aria-label="Files" aria-multiselectable="true" className="text-[13px] select-none">
      <div
        role="row"
        className={`hidden lg:grid ${COLS} gap-4 px-4 h-9 items-center border-b border-tf-border text-[11px] font-semibold uppercase tracking-[0.08em] text-tf-faint`}
      >
        <span role="columnheader">Name</span>
        <span role="columnheader">What's inside</span>
        <span role="columnheader">Really lives in</span>
        <span role="columnheader" className="sr-only">
          Actions
        </span>
      </div>

      {subfolders.map((f) => (
        <div
          key={`folder-${f.id}`}
          role="row"
          onDoubleClick={() => onOpenFolder(f.id)}
          className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLS} gap-4 px-4 py-2 items-center border-b border-tf-border hover:bg-tf-surface-2 transition-colors`}
        >
          <button
            type="button"
            role="gridcell"
            onClick={() => onOpenFolder(f.id)}
            className="flex items-center gap-3 min-w-0 text-left font-medium text-tf-ink cursor-pointer focus-visible:outline-none focus-visible:underline"
          >
            <span className="w-8 h-8 shrink-0 flex items-center justify-center">
              <FolderGlyph real={f.is_real} size={24} />
            </span>
            <span className="truncate">{f.name}</span>
          </button>
          <span role="gridcell" className="hidden lg:block text-tf-muted tf-num">
            {subfolderTotals.get(f.id) ?? f.count} {(subfolderTotals.get(f.id) ?? f.count) === 1 ? "file" : "files"}
          </span>
          <span role="gridcell" className="hidden lg:block text-tf-muted truncate" title={f.disk_path || undefined}>
            {f.is_real ? f.disk_label || f.disk_path : "Only in TidyFlow"}
          </span>
          <span role="gridcell" />
        </div>
      ))}

      {files.map((file) => {
        const where = file.missing ? `Last seen in ${file.lives_in}` : file.lives_in;
        const isSelected = selected.has(file.id);
        const faded = file.missing || cutIds.has(file.id);
        return (
          <div
            key={file.id}
            role="row"
            aria-selected={isSelected}
            data-file-id={file.id}
            onClick={(e) => onSelect(file.id, { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey })}
            onDoubleClick={() => file.current_path && onOpenPath(file.current_path, false)}
            className={`grid grid-cols-[minmax(0,1fr)_auto] ${COLS} gap-4 px-4 py-2.5 items-center border-b border-tf-border last:border-b-0 transition-colors cursor-default ${
              isSelected ? "bg-tf-link/12 shadow-[inset_2px_0_0_var(--color-tf-link)]" : "hover:bg-tf-surface-2"
            }`}
          >
            <div role="gridcell" className={`flex items-center gap-3 min-w-0 ${faded ? "opacity-55" : ""}`}>
              {file.missing ? (
                <span className="w-8 h-8 shrink-0 rounded-[7px] bg-tf-surface-3 flex items-center justify-center text-tf-faint">
                  <FileQuestion size={16} strokeWidth={1.75} />
                </span>
              ) : (
                <FilePreview extension={file.extension} thumbnailB64={file.thumbnail_b64 || undefined} size={32} />
              )}
              <div className="min-w-0">
                {renamingId === file.id ? (
                  <RenameInput
                    name={file.name}
                    onSubmit={(name) => onRename(file.id, name)}
                    onCancel={onRenameCancel}
                  />
                ) : (
                  <div className="truncate font-medium text-tf-ink" title={file.name}>
                    {file.name}
                  </div>
                )}
                <div className="truncate text-[12px] text-tf-faint tf-num">
                  {file.missing ? (
                    <span className="text-tf-warn">Can't find this file</span>
                  ) : (
                    file.file_size_bytes > 0 && formatBytes(file.file_size_bytes)
                  )}
                  {/* On narrower windows the location goes under the name. */}
                  <span className="lg:hidden">
                    {(file.missing || file.file_size_bytes > 0) && " · "}
                    {where}
                  </span>
                </div>
              </div>
            </div>
            <p role="gridcell" className={`hidden lg:block ${faded ? "opacity-55" : ""} text-tf-muted line-clamp-2 leading-[1.45]`} title={file.summary}>
              {file.summary || <span className="text-tf-faint">No text found</span>}
            </p>
            <span
              role="gridcell"
              className={`hidden lg:block truncate ${file.missing ? "text-tf-warn" : "text-tf-ink-2"} ${faded ? "opacity-55" : ""}`}
              title={file.current_path || file.path}
            >
              {where}
            </span>
            <div role="gridcell" className="flex items-center justify-end gap-0.5" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                disabled={!file.current_path}
                onClick={() => file.current_path && onOpenPath(file.current_path, false)}
                aria-label={`Open ${file.name}`}
                title="Open"
                className={iconButton}
              >
                <ExternalLink size={15} strokeWidth={1.75} />
              </button>
              <button
                type="button"
                disabled={!file.current_path}
                onClick={() => file.current_path && onOpenPath(file.current_path, true)}
                aria-label={`${REVEAL_LABEL}: ${file.name}`}
                title={REVEAL_LABEL}
                className={iconButton}
              >
                <FolderSearch size={15} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
