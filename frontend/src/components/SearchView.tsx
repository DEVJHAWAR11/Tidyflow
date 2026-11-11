import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FtsResultItem } from "../types";
import { API_BASE } from "../config";
import { prettyFolderName, formatBytes } from "../utils/folderVisuals";
import { Screen, Card, Button, StepHeader, Skeleton } from "../flow/ui";
import { FilePreview, FolderIcon } from "../flow/icons";
import { Search, X, Copy, Check, Eye, FolderOpen, ExternalLink, Clock, ChevronUp, ChevronDown } from "lucide-react";

const isMac = typeof navigator !== "undefined" && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);
const FINDER = isMac ? "Finder" : "File Explorer";
const PAGE_SIZE = 30;
const TYPING_PAUSE_MS = 160;
const RECENTS_KEY = "tidyflow_recent_searches";
const STATE_KEY = "tidyflow_search_state";

type Kind = "documents" | "images" | "sheets" | "slides" | "media" | "archives" | "other";
const KIND_LABELS: Record<Kind, string> = {
  documents: "Documents",
  images: "Images",
  sheets: "Spreadsheets",
  slides: "Slides",
  media: "Video & audio",
  archives: "Archives",
  other: "Other",
};

interface Filters {
  category: string | null;
  kind: Kind | null;
  organized: boolean | null;
}
const NO_FILTERS: Filters = { category: null, kind: null, organized: null };

interface Facets {
  categories: Record<string, number>;
  kinds: Partial<Record<Kind, number>>;
  organized: number;
  unorganized: number;
}

interface SearchPage {
  results: FtsResultItem[];
  total: number;
  facets: Facets | null;
  corrected: string | null;
}

interface Stats {
  files: number;
  with_text: number;
  categories: { name: string; count: number }[];
}

function readJson<T>(storage: Storage | undefined, key: string, fallback: T): T {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(storage: Storage | undefined, key: string, value: unknown) {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be full or blocked; the page works without it.
  }
}

const currentPath = (item: FtsResultItem) => item.current_path || item.new_path || item.path;
const fileName = (item: FtsResultItem) => item.name || currentPath(item).split(/[\\/]/).pop() || item.path;

/** The folder a file sits in, with the home folder shortened to "~". */
function parentFolder(path: string): string {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  const dir = cut > 0 ? path.slice(0, cut) : path;
  return dir.replace(/^\/Users\/[^/]+/, "~").replace(/^\/home\/[^/]+/, "~").replace(/^[A-Za-z]:\\Users\\[^\\]+/, "~");
}

function formatDate(seconds?: number | null): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// No side padding: a match inside a word must not push its letters apart.
const MARK = "bg-tf-warn-soft text-tf-ink rounded-[2px]";

/** `text` with every searched word wrapped in a highlight. */
function Highlighted({ text, words }: { text: string; words: string[] }) {
  const pattern = useMemo(() => {
    const parts = words.filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    return parts.length ? new RegExp(`(${parts.join("|")})`, "ig") : null;
  }, [words]);
  if (!pattern) return <>{text}</>;
  return (
    <>
      {text.split(pattern).map((part, i) =>
        i % 2 === 1 ? (
          <mark key={i} className={MARK}>
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Chip({
  active,
  onClick,
  children,
  count,
}: {
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`h-7 px-2.5 inline-flex items-center gap-1.5 rounded-[7px] border text-[12.5px] whitespace-nowrap transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-ink ${
        active
          ? "bg-tf-ink text-tf-bg border-tf-ink"
          : "border-tf-border text-tf-ink-2 hover:bg-tf-surface-2"
      }`}
    >
      {children}
      {count !== undefined && <span className={`tf-num ${active ? "opacity-70" : "text-tf-faint"}`}>{count}</span>}
    </button>
  );
}

const Kbd = ({ children }: { children: React.ReactNode }) => (
  <kbd className="inline-flex items-center h-[18px] px-1 rounded-[4px] border border-tf-border-strong bg-tf-surface text-[11px] font-sans text-tf-muted tf-num">
    {children}
  </kbd>
);

export function SearchView() {
  const saved = useMemo(
    () => readJson<{ query: string; filters: Filters }>(globalThis.sessionStorage, STATE_KEY, { query: "", filters: NO_FILTERS }),
    [],
  );
  const [query, setQuery] = useState(saved.query);
  const [filters, setFilters] = useState<Filters>(saved.filters);
  const [page, setPage] = useState<SearchPage | null>(null);
  const [searched, setSearched] = useState(""); // the query the shown results belong to
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recents, setRecents] = useState<string[]>(() => readJson(globalThis.localStorage, RECENTS_KEY, []));
  const [done, setDone] = useState<{ id: string; what: "open" | "reveal" | "copy" } | null>(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const requestId = useRef(0);
  const firstRun = useRef(true);

  const results = page?.results ?? [];
  const facets = page?.facets ?? null;
  const hasFilters = filters.category !== null || filters.kind !== null || filters.organized !== null;
  const words = useMemo(() => ((page?.corrected || searched).match(/[\p{L}\p{N}_]+/gu) ?? []), [page?.corrected, searched]);

  const fetchPage = useCallback(async (q: string, f: Filters, offset: number): Promise<SearchPage> => {
    const params = new URLSearchParams({ q, limit: String(PAGE_SIZE), offset: String(offset) });
    if (f.category) params.set("category", f.category);
    if (f.kind) params.set("kind", f.kind);
    if (f.organized !== null) params.set("organized", String(f.organized));
    const res = await fetch(`${API_BASE}/search?${params}`);
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    return res.json();
  }, []);

  // Search as you type: wait for a short pause, and ignore answers to older keystrokes.
  useEffect(() => {
    const q = query.trim();
    writeJson(globalThis.sessionStorage, STATE_KEY, { query, filters });
    const id = ++requestId.current;
    if (!q) {
      setPage(null);
      setSearched("");
      setLoading(false);
      setFailed(false);
      return;
    }
    setLoading(true);
    const wait = firstRun.current ? 0 : TYPING_PAUSE_MS;
    firstRun.current = false;
    const timer = setTimeout(async () => {
      try {
        const data = await fetchPage(q, filters, 0);
        if (id !== requestId.current) return;
        setPage(data);
        setSearched(q);
        setFailed(false);
      } catch {
        if (id !== requestId.current) return;
        setFailed(true);
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, wait);
    return () => clearTimeout(timer);
  }, [query, filters, fetchPage]);

  useEffect(() => {
    inputRef.current?.focus();
    fetch(`${API_BASE}/search/stats`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setStats)
      .catch(() => {});
  }, []);

  const remember = useCallback((q: string) => {
    const clean = q.trim();
    if (clean.length < 2) return;
    setRecents((old) => {
      const next = [clean, ...old.filter((r) => r.toLowerCase() !== clean.toLowerCase())].slice(0, 6);
      writeJson(globalThis.localStorage, RECENTS_KEY, next);
      return next;
    });
  }, []);

  const showMore = async () => {
    if (!page || loadingMore) return;
    const id = requestId.current;
    setLoadingMore(true);
    try {
      const more = await fetchPage(searched, filters, page.results.length);
      if (id !== requestId.current) return;
      const seen = new Set(page.results.map((r) => r.id));
      setPage({ ...page, total: more.total, results: [...page.results, ...more.results.filter((r) => !seen.has(r.id))] });
    } catch {
      // The list stays as it is; the button can be pressed again.
    } finally {
      setLoadingMore(false);
    }
  };

  const flash = (item: FtsResultItem, what: "open" | "reveal" | "copy") => {
    const id = String(item.id);
    setDone({ id, what });
    setTimeout(() => setDone((d) => (d && d.id === id && d.what === what ? null : d)), 1800);
  };

  const openPath = async (item: FtsResultItem, reveal: boolean) => {
    remember(searched);
    try {
      const res = await fetch(`${API_BASE}/fs/open-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: currentPath(item), reveal }),
      });
      if (res.ok) flash(item, reveal ? "reveal" : "open");
    } catch (err) {
      console.error("Could not open the file:", err);
    }
  };

  const copyPath = (item: FtsResultItem) => {
    navigator.clipboard?.writeText(currentPath(item));
    flash(item, "copy");
  };

  const focusInput = (select = false) => {
    inputRef.current?.focus();
    if (select) inputRef.current?.select();
  };
  const focusRow = (i: number) => rowRefs.current[i]?.focus();

  // "/" or Cmd/Ctrl+K jumps to the search box from anywhere on the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (previewIndex !== null) return;
      const typing = document.activeElement === inputRef.current;
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        focusInput(true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previewIndex]);

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" && results.length) {
      e.preventDefault();
      focusRow(0);
    } else if (e.key === "Enter") {
      remember(query);
    } else if (e.key === "Escape" && query) {
      e.preventDefault();
      setQuery("");
    }
  };

  const onRowKey = (e: React.KeyboardEvent, item: FtsResultItem, i: number) => {
    if (e.target !== e.currentTarget) return; // a key pressed on one of the row's buttons
    if (previewIndex !== null) return; // the preview handles its own keys
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (i + 1 < results.length) focusRow(i + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (i === 0) focusInput();
      else focusRow(i - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      openPath(item, e.metaKey || e.ctrlKey);
    } else if (e.key === " ") {
      e.preventDefault();
      e.stopPropagation(); // or the preview, listening on the window, would close on this same key press
      setPreviewIndex(i);
    } else if (e.key === "Escape" || e.key === "Backspace" || (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey)) {
      focusInput(); // carry on typing
    }
  };

  const closePreview = () => {
    const i = previewIndex;
    setPreviewIndex(null);
    if (i !== null) requestAnimationFrame(() => focusRow(i));
  };

  const toggle = <K extends keyof Filters>(key: K, value: Filters[K]) =>
    setFilters((f) => ({ ...f, [key]: f[key] === value ? null : value }));

  const categoryChips = useMemo(() => {
    const entries = Object.entries(facets?.categories ?? {}).sort((a, b) => b[1] - a[1]);
    const top = entries.slice(0, 6);
    if (filters.category && !top.some(([name]) => name === filters.category)) {
      top.push([filters.category, facets?.categories[filters.category] ?? 0]);
    }
    return top.length > 1 || filters.category ? top : [];
  }, [facets, filters.category]);

  const kindChips = useMemo(() => {
    const entries = (Object.entries(facets?.kinds ?? {}) as [Kind, number][]).sort((a, b) => b[1] - a[1]);
    if (filters.kind && !entries.some(([k]) => k === filters.kind)) entries.push([filters.kind, 0]);
    return entries.length > 1 || filters.kind ? entries : [];
  }, [facets, filters.kind]);

  const showPlace = !!facets && ((facets.organized > 0 && facets.unorganized > 0) || filters.organized !== null);
  const showSkeleton = loading && results.length === 0 && !(page && searched);
  const empty = !query.trim();

  return (
    <Screen className="max-w-[760px] mx-auto pt-8 px-4 pb-16">
      <StepHeader title="Find a file" subtitle="Search file names and the text inside documents, receipts and screenshots." />

      {/* Search field */}
      <div className="relative mt-6 flex items-center">
        <Search size={17} strokeWidth={1.75} className="text-tf-faint absolute left-3.5 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onInputKey}
          onBlur={() => results.length > 0 && remember(searched)}
          placeholder="Search file names and contents..."
          aria-label="Search files"
          autoComplete="off"
          spellCheck={false}
          className="w-full h-11 pl-10 pr-20 rounded-[8px] bg-tf-surface border border-tf-border-strong text-[14.5px] text-tf-ink placeholder:text-tf-faint focus:outline-none focus:border-tf-ink focus:ring-1 focus:ring-tf-ink transition-colors"
        />
        <div className="absolute right-2.5 flex items-center gap-1.5">
          {loading && (
            <span
              aria-hidden
              className="w-3.5 h-3.5 rounded-full border-[1.5px] border-tf-border-strong border-t-tf-ink animate-spin"
            />
          )}
          {query ? (
            <button
              type="button"
              onClick={() => {
                setQuery("");
                focusInput();
              }}
              aria-label="Clear search"
              title="Clear (Esc)"
              className="text-tf-muted hover:text-tf-ink p-1 rounded cursor-pointer"
            >
              <X size={15} strokeWidth={1.75} />
            </button>
          ) : (
            <Kbd>{isMac ? "⌘K" : "Ctrl K"}</Kbd>
          )}
        </div>
      </div>

      {/* Before a search: recent searches, the user's folders, and what search covers */}
      {empty && (
        <div className="mt-5 space-y-5">
          {recents.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[12px] text-tf-faint">Recent searches</span>
                <button
                  type="button"
                  onClick={() => {
                    setRecents([]);
                    writeJson(globalThis.localStorage, RECENTS_KEY, []);
                  }}
                  className="text-[12px] text-tf-muted hover:text-tf-ink cursor-pointer"
                >
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {recents.map((r) => (
                  <Chip key={r} onClick={() => setQuery(r)}>
                    <Clock size={12} strokeWidth={1.75} className="text-tf-faint" />
                    {r}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          {stats && stats.categories.length > 0 && (
            <div>
              <div className="text-[12px] text-tf-faint mb-2">Your folders</div>
              <div className="flex flex-wrap gap-1.5">
                {stats.categories.map((c) => (
                  <Chip key={c.name} count={c.count} onClick={() => setQuery(prettyFolderName(c.name))}>
                    <FolderIcon name={c.name} size={14} />
                    {prettyFolderName(c.name)}
                  </Chip>
                ))}
              </div>
            </div>
          )}

          <div className="pt-8 text-center max-w-sm mx-auto space-y-2">
            <div className="w-10 h-10 rounded-[10px] border border-tf-border-strong bg-tf-surface grid place-items-center mx-auto text-tf-muted shadow-2xs">
              <Search size={20} strokeWidth={1.75} />
            </div>
            <h3 className="text-[14.5px] font-medium text-tf-ink">Search everything TidyFlow has sorted</h3>
            {stats && (
              <p className="text-[13px] text-tf-muted tf-num">
                {stats.files === 0
                  ? "Nothing has been sorted yet. Sort a folder and its files show up here."
                  : `${stats.files.toLocaleString()} files. ${stats.with_text.toLocaleString()} have text inside that can be searched; the rest are found by name.`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Filters, built from what the search found */}
      {!empty && facets && (categoryChips.length > 0 || kindChips.length > 0 || showPlace) && (
        <div className="mt-3 space-y-1.5">
          {categoryChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {categoryChips.map(([name, count]) => (
                <Chip key={name} active={filters.category === name} count={count} onClick={() => toggle("category", name)}>
                  <FolderIcon name={name} size={14} />
                  {prettyFolderName(name)}
                </Chip>
              ))}
            </div>
          )}
          {(kindChips.length > 0 || showPlace) && (
            <div className="flex flex-wrap gap-1.5">
              {kindChips.map(([kind, count]) => (
                <Chip key={kind} active={filters.kind === kind} count={count} onClick={() => toggle("kind", kind)}>
                  {KIND_LABELS[kind]}
                </Chip>
              ))}
              {showPlace && (
                <>
                  <Chip active={filters.organized === true} count={facets.organized} onClick={() => toggle("organized", true)}>
                    Organized
                  </Chip>
                  <Chip active={filters.organized === false} count={facets.unorganized} onClick={() => toggle("organized", false)}>
                    Not organized yet
                  </Chip>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {showSkeleton && (
        <Card className="mt-6 divide-y divide-tf-border overflow-hidden">
          {[1, 2, 3].map((i) => (
            <div key={i} className="px-4 py-3 flex gap-3.5 items-start">
              <Skeleton className="w-9 h-9 rounded-[8px] shrink-0" />
              <div className="flex-1 space-y-2 py-0.5">
                <Skeleton className="h-4 w-1/3 rounded-[4px]" />
                <Skeleton className="h-3 w-1/2 rounded-[4px]" />
              </div>
            </div>
          ))}
        </Card>
      )}

      {failed && !loading && (
        <p className="mt-10 text-center text-[13px] text-tf-danger">Search isn't answering. Check that TidyFlow is still running.</p>
      )}

      {/* Nothing found */}
      {!empty && !failed && page && results.length === 0 && !showSkeleton && (
        <div className="mt-12 text-center max-w-sm mx-auto space-y-3">
          <p className="text-[13.5px] text-tf-ink">
            No files match “{searched}”{hasFilters ? " with these filters" : ""}.
          </p>
          {hasFilters ? (
            <Button variant="secondary" size="sm" onClick={() => setFilters(NO_FILTERS)}>
              Clear filters
            </Button>
          ) : (
            <p className="text-[12.5px] text-tf-muted">
              Try fewer or shorter words. Only folders TidyFlow has sorted can be searched.
            </p>
          )}
        </div>
      )}

      {/* Results */}
      {!empty && results.length > 0 && (
        <div className={`mt-5 space-y-2.5 transition-opacity duration-150 ${loading ? "opacity-60" : ""}`}>
          <div className="flex items-center justify-between gap-3 text-[12.5px] text-tf-muted tf-num">
            <span aria-live="polite">
              {page!.corrected ? (
                <>
                  Nothing for “{searched}”. Showing {page!.total.toLocaleString()} for{" "}
                  <span className="text-tf-ink font-medium">“{page!.corrected}”</span>
                </>
              ) : (
                <>
                  {page!.total.toLocaleString()} {page!.total === 1 ? "result" : "results"}
                  {hasFilters && (
                    <button
                      type="button"
                      onClick={() => setFilters(NO_FILTERS)}
                      className="ml-2 underline underline-offset-2 hover:text-tf-ink cursor-pointer"
                    >
                      Clear filters
                    </button>
                  )}
                </>
              )}
            </span>
            <span className="hidden sm:flex items-center gap-1.5 text-tf-faint">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd> move <Kbd>↵</Kbd> open <Kbd>Space</Kbd> preview
            </span>
          </div>

          <Card className="divide-y divide-tf-border overflow-hidden" role="listbox" aria-label="Search results">
            {results.map((item, i) => {
              const name = fileName(item);
              const path = currentPath(item);
              const id = String(item.id);
              const organized = !!item.new_path && path === item.new_path;
              const did = done && done.id === id ? done.what : null;
              const meta = [item.file_size_bytes ? formatBytes(item.file_size_bytes) : "", formatDate(item.modified)].filter(Boolean);

              return (
                <div
                  key={id}
                  ref={(el) => {
                    rowRefs.current[i] = el;
                  }}
                  role="option"
                  aria-selected={false}
                  tabIndex={-1}
                  onClick={() => openPath(item, false)}
                  onKeyDown={(e) => onRowKey(e, item, i)}
                  title={`Open ${name}`}
                  className="group relative px-4 py-3 flex gap-3.5 items-start cursor-pointer scroll-my-24 transition-colors hover:bg-tf-surface-2/60 focus:bg-tf-surface-2 focus:outline-none focus-visible:shadow-[inset_2px_0_0_var(--color-tf-ink)]"
                >
                  <FilePreview
                    extension={item.extension || ""}
                    fileCategory={item.category}
                    thumbnailB64={item.thumbnail_b64}
                    size={36}
                  />

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13.5px] font-medium text-tf-ink truncate">
                        <Highlighted text={name} words={words} />
                      </span>
                      {did === "open" && <span className="shrink-0 text-[11.5px] text-tf-success">Opened</span>}
                    </div>

                    <div className="flex items-center gap-1.5 text-[12px] text-tf-muted mt-0.5 min-w-0">
                      {item.category && item.category !== "Unknown" && (
                        <>
                          <FolderIcon name={item.category} size={14} />
                          <span className="font-medium text-tf-ink-2 whitespace-nowrap shrink-0">
                            {prettyFolderName(item.category)}
                          </span>
                          <span className="text-tf-faint">·</span>
                        </>
                      )}
                      <span className="text-tf-faint truncate min-w-0" title={path}>
                        {parentFolder(path)}
                      </span>
                      {meta.length > 0 && (
                        <span className="text-tf-faint whitespace-nowrap shrink-0 tf-num hidden sm:inline">· {meta.join(" · ")}</span>
                      )}
                      {!organized && item.status !== "copied" && item.status !== "moved" && (
                        <span className="shrink-0 text-tf-faint whitespace-nowrap hidden md:inline">· not organized yet</span>
                      )}
                    </div>

                    {item.snippet ? (
                      <div
                        className="text-[12.5px] text-tf-ink-2 line-clamp-2 mt-1 leading-relaxed [&_mark]:bg-tf-warn-soft [&_mark]:text-tf-ink [&_mark]:rounded-[3px] [&_mark]:px-0.5"
                        // The backend escapes the file's text and only adds <mark> tags.
                        dangerouslySetInnerHTML={{ __html: item.snippet }}
                      />
                    ) : null}
                  </div>

                  <div
                    className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 group-focus:opacity-100 group-focus-within:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <RowButton label="Preview (Space)" onClick={() => setPreviewIndex(i)}>
                      <Eye size={15} strokeWidth={1.75} />
                    </RowButton>
                    <RowButton label={`Show in ${FINDER} (${isMac ? "⌘" : "Ctrl "}↵)`} onClick={() => openPath(item, true)}>
                      {did === "reveal" ? <Check size={15} strokeWidth={1.75} className="text-tf-success" /> : <FolderOpen size={15} strokeWidth={1.75} />}
                    </RowButton>
                    <RowButton label="Copy path" onClick={() => copyPath(item)}>
                      {did === "copy" ? <Check size={15} strokeWidth={1.75} className="text-tf-success" /> : <Copy size={15} strokeWidth={1.75} />}
                    </RowButton>
                  </div>
                </div>
              );
            })}
          </Card>

          {results.length < page!.total && (
            <div className="flex items-center justify-center gap-3 pt-2">
              <span className="text-[12.5px] text-tf-muted tf-num">
                Showing {results.length} of {page!.total.toLocaleString()}
              </span>
              <Button variant="secondary" size="sm" onClick={showMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          )}
        </div>
      )}

      {previewIndex !== null && results[previewIndex] && (
        <PreviewDialog
          item={results[previewIndex]}
          words={words}
          position={`${previewIndex + 1} of ${results.length}`}
          did={done && done.id === String(results[previewIndex].id) ? done.what : null}
          onClose={closePreview}
          onStep={(by) => setPreviewIndex((i) => (i === null ? i : Math.min(results.length - 1, Math.max(0, i + by))))}
          onOpen={(reveal) => openPath(results[previewIndex], reveal)}
          onCopy={() => copyPath(results[previewIndex])}
        />
      )}
    </Screen>
  );
}

function RowButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="w-7 h-7 rounded-[7px] flex items-center justify-center text-tf-muted hover:text-tf-ink hover:bg-tf-surface-3 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-ink"
    >
      {children}
    </button>
  );
}

/** A closer look at one result: a sharp preview, where it is, why it is there, and the words inside. */
function PreviewDialog({
  item,
  words,
  position,
  did,
  onClose,
  onStep,
  onOpen,
  onCopy,
}: {
  item: FtsResultItem;
  words: string[];
  position: string;
  did: "open" | "reveal" | "copy" | null;
  onClose: () => void;
  onStep: (by: number) => void;
  onOpen: (reveal: boolean) => void;
  onCopy: () => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [sharp, setSharp] = useState<"loading" | "ready" | "none">("loading");
  const path = currentPath(item);
  const name = fileName(item);

  useEffect(() => {
    let live = true;
    setText(null);
    setSharp("loading");
    fetch(`${API_BASE}/search/file/${item.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setText(d?.extracted_text ?? ""))
      .catch(() => live && setText(""));
    return () => {
      live = false;
    };
  }, [item.id]);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === " ") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        onStep(1);
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        onStep(-1);
      } else if (e.key === "Enter") {
        e.preventDefault();
        onOpen(e.metaKey || e.ctrlKey);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose, onStep, onOpen]);

  return createPortal(
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-xs z-[9999] flex items-center justify-center p-4 animate-fade-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Preview of ${name}`}
    >
      <div
        className="bg-tf-surface border border-tf-border-strong rounded-[12px] max-w-3xl w-full max-h-[88vh] p-5 shadow-[var(--shadow-tf-float)] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-tf-border pb-3.5 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <FilePreview extension={item.extension || ""} fileCategory={item.category} size={32} />
            <div className="min-w-0">
              <h3 className="text-[15px] font-semibold text-tf-ink truncate">{name}</h3>
              <div className="text-[12px] text-tf-muted mt-0.5 flex items-center gap-1.5 min-w-0">
                {item.category && item.category !== "Unknown" && (
                  <>
                    <FolderIcon name={item.category} size={14} />
                    <span className="font-medium text-tf-ink-2 shrink-0">{prettyFolderName(item.category)}</span>
                    <span className="text-tf-faint">·</span>
                  </>
                )}
                <span className="tf-num truncate">
                  {[item.file_size_bytes ? formatBytes(item.file_size_bytes) : "", formatDate(item.modified)].filter(Boolean).join(" · ")}
                </span>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <span className="text-[12px] text-tf-faint tf-num mr-1.5 hidden sm:inline">{position}</span>
            <RowButton label="Previous (↑)" onClick={() => onStep(-1)}>
              <ChevronUp size={16} strokeWidth={1.75} />
            </RowButton>
            <RowButton label="Next (↓)" onClick={() => onStep(1)}>
              <ChevronDown size={16} strokeWidth={1.75} />
            </RowButton>
            <RowButton label="Close (Esc)" onClick={onClose}>
              <X size={16} strokeWidth={1.75} />
            </RowButton>
          </div>
        </div>

        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-5 pt-4 min-h-0 overflow-y-auto md:overflow-hidden">
          <div className="md:col-span-7 relative bg-tf-surface-2 rounded-[8px] border border-tf-border flex items-center justify-center p-3 overflow-hidden min-h-[220px] md:min-h-[360px]">
            {/* The small thumbnail shows at once; the sharp preview fades in over it when it is ready. */}
            {item.thumbnail_b64 && sharp !== "ready" && (
              <img
                src={`data:image/png;base64,${item.thumbnail_b64}`}
                alt=""
                className="max-h-full max-w-full h-full object-contain rounded-[6px] blur-[1px]"
              />
            )}
            {!item.thumbnail_b64 && sharp === "none" && (
              <div className="text-center space-y-2 p-6">
                <FilePreview extension={item.extension || ""} fileCategory={item.category} size={48} className="mx-auto" />
                <p className="text-[12.5px] text-tf-muted">No preview for this kind of file.</p>
              </div>
            )}
            {sharp !== "none" && (
              <img
                key={item.id}
                src={`${API_BASE}/search/preview/${item.id}?size=960`}
                alt={`Preview of ${name}`}
                draggable={false}
                onLoad={() => setSharp("ready")}
                onError={() => setSharp("none")}
                className={`absolute inset-3 w-[calc(100%-1.5rem)] h-[calc(100%-1.5rem)] object-contain rounded-[6px] transition-opacity duration-200 ${
                  sharp === "ready" ? "opacity-100" : "opacity-0"
                }`}
              />
            )}
          </div>

          <div className="md:col-span-5 flex flex-col gap-3 min-h-0 md:overflow-y-auto">
            <div className="bg-tf-surface-2 p-3 rounded-[8px] border border-tf-border space-y-1.5 shrink-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-tf-muted">Where it is</div>
              <p className="text-[12px] text-tf-ink-2 break-all leading-snug" title={path}>
                {parentFolder(path)}
              </p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <Button variant="primary" size="sm" icon={<ExternalLink size={14} />} onClick={() => onOpen(false)}>
                  {did === "open" ? "Opened" : "Open"}
                </Button>
                <Button variant="secondary" size="sm" icon={<FolderOpen size={14} />} onClick={() => onOpen(true)}>
                  {did === "reveal" ? "Shown" : FINDER}
                </Button>
                <Button variant="secondary" size="sm" icon={did === "copy" ? <Check size={14} /> : <Copy size={14} />} onClick={onCopy}>
                  {did === "copy" ? "Copied" : "Copy path"}
                </Button>
              </div>
            </div>

            {item.reason && (
              <div className="bg-tf-surface-2 p-3 rounded-[8px] border border-tf-border space-y-1 shrink-0">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-tf-muted">Why it's in this folder</div>
                <p className="text-[12.5px] text-tf-ink-2 leading-relaxed">{item.reason}</p>
              </div>
            )}

            {text === null ? (
              <Skeleton className="h-24 rounded-[8px] shrink-0" />
            ) : text ? (
              <div className="flex-1 flex flex-col min-h-[120px] gap-1">
                <div className="text-[11px] font-semibold uppercase tracking-wider text-tf-muted">Words found inside</div>
                <div className="flex-1 text-[12px] text-tf-ink-2 bg-tf-surface-2 p-3 rounded-[8px] border border-tf-border whitespace-pre-wrap break-words overflow-y-auto leading-relaxed">
                  <Highlighted text={text} words={words} />
                </div>
              </div>
            ) : (
              <p className="text-[12.5px] text-tf-muted">No text was read from this file, so it is found by its name only.</p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 pt-3 mt-3 border-t border-tf-border shrink-0 text-[12px] text-tf-faint">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> next file <Kbd>↵</Kbd> open <Kbd>Esc</Kbd> close
        </div>
      </div>
    </div>,
    document.body,
  );
}
