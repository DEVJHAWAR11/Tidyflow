// The folder list on the left of the Library: TidyFlow folders as a tree, then "Not sorted yet".
import { useMemo, useState } from "react";
import { ChevronRight, Inbox } from "lucide-react";
import { FolderGlyph, FolderLegend } from "./FolderGlyph";
import type { FolderKey, LibraryFolder } from "./libraryApi";

export interface FolderIndex {
  byId: Map<number, LibraryFolder>;
  children: Map<number | null, LibraryFolder[]>;
  /** Files in a folder and all its subfolders. */
  total: Map<number, number>;
}

export function indexFolders(folders: LibraryFolder[]): FolderIndex {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const children = new Map<number | null, LibraryFolder[]>();
  for (const f of folders) {
    // A folder whose parent is gone is shown at the top level rather than lost.
    const parent = f.parent_id !== null && byId.has(f.parent_id) ? f.parent_id : null;
    children.set(parent, [...(children.get(parent) || []), f]);
  }
  const total = new Map<number, number>();
  const sum = (f: LibraryFolder): number => {
    const n = f.count + (children.get(f.id) || []).reduce((acc, c) => acc + sum(c), 0);
    total.set(f.id, n);
    return n;
  };
  (children.get(null) || []).forEach(sum);
  return { byId, children, total };
}

/** The folder and its parents, top-level first. */
export function folderTrail(index: FolderIndex, id: number): LibraryFolder[] {
  const trail: LibraryFolder[] = [];
  let f = index.byId.get(id);
  while (f && trail.length < 32) {
    trail.unshift(f);
    f = f.parent_id !== null ? index.byId.get(f.parent_id) : undefined;
  }
  return trail;
}

const rowClass = (selected: boolean) =>
  `w-full flex items-center gap-2 h-8 pr-2 rounded-[7px] text-left text-[13px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40 ${
    selected ? "bg-tf-surface-3 text-tf-ink font-medium" : "text-tf-ink-2 hover:bg-tf-surface-2 hover:text-tf-ink"
  }`;

export function FolderTree({
  index,
  unsortedCount,
  selected,
  onSelect,
}: {
  index: FolderIndex;
  unsortedCount: number;
  selected: FolderKey;
  onSelect: (key: FolderKey) => void;
}) {
  // Folders start open; the ones closed by hand are remembered while the Library is open.
  const [closed, setClosed] = useState<Set<number>>(new Set());
  const openTrail = useMemo(
    () => new Set(typeof selected === "number" ? folderTrail(index, selected).map((f) => f.id) : []),
    [index, selected],
  );

  const toggle = (id: number) =>
    setClosed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderLevel = (parent: number | null, depth: number): React.ReactNode =>
    (index.children.get(parent) || []).map((f) => {
      const kids = index.children.get(f.id) || [];
      // The selected folder's parents stay open, so the selection is always visible.
      const open = kids.length > 0 && (!closed.has(f.id) || (openTrail.has(f.id) && f.id !== selected));
      return (
        <li key={f.id}>
          <div className="relative">
            <button
              type="button"
              onClick={() => onSelect(f.id)}
              aria-current={selected === f.id ? "true" : undefined}
              className={rowClass(selected === f.id)}
              style={{ paddingLeft: 26 + depth * 14 }}
              title={f.is_real && f.disk_path ? `Real folder: ${f.disk_path}` : "Only in TidyFlow"}
            >
              <FolderGlyph real={f.is_real} />
              <span className="flex-1 truncate">{f.name}</span>
              <span className="text-[12px] text-tf-faint tf-num">{index.total.get(f.id) ?? f.count}</span>
            </button>
            {kids.length > 0 && (
              <button
                type="button"
                onClick={() => toggle(f.id)}
                aria-label={open ? `Close ${f.name}` : `Open ${f.name}`}
                aria-expanded={open}
                className="absolute top-1/2 -translate-y-1/2 w-5 h-5 rounded-[5px] flex items-center justify-center text-tf-faint hover:text-tf-ink hover:bg-tf-surface-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40"
                style={{ left: 4 + depth * 14 }}
              >
                <ChevronRight size={13} strokeWidth={2} className={`transition-transform ${open ? "rotate-90" : ""}`} />
              </button>
            )}
          </div>
          {open && <ul>{renderLevel(f.id, depth + 1)}</ul>}
        </li>
      );
    });

  return (
    <nav aria-label="TidyFlow folders" className="flex flex-col gap-4">
      <div>
        <div className="px-2 mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-tf-faint">Folders</div>
        {index.byId.size > 0 ? (
          <ul>{renderLevel(null, 0)}</ul>
        ) : (
          <p className="px-2 text-[12.5px] text-tf-faint">No folders yet.</p>
        )}
      </div>
      <div className="border-t border-tf-border pt-3">
        <button
          type="button"
          onClick={() => onSelect("unsorted")}
          aria-current={selected === "unsorted" ? "true" : undefined}
          className={rowClass(selected === "unsorted")}
          style={{ paddingLeft: 26 }}
        >
          <Inbox size={16} strokeWidth={1.75} className="shrink-0 text-tf-faint" />
          <span className="flex-1 truncate">Not sorted yet</span>
          <span className="text-[12px] text-tf-faint tf-num">{unsortedCount}</span>
        </button>
      </div>
      <div className="px-2 pt-1">
        <FolderLegend />
      </div>
    </nav>
  );
}
