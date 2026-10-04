import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { FtsResultItem } from "../types";
import { API_BASE } from "../config";
import { prettyFolderName } from "../utils/folderVisuals";
import { Screen, Card, Button, StepHeader, Skeleton } from "../flow/ui";
import { FilePreview, FolderIcon } from "../flow/icons";
import {
  Search,
  X,
  Copy,
  Check,
  Eye,
  FolderOpen,
  ExternalLink,
  FileText,
} from "lucide-react";

export interface SearchViewProps {
  ftsQuery: string;
  setFtsQuery: (val: string) => void;
  ftsResults: FtsResultItem[];
  isSearching: boolean;
  hasSearched: boolean;
  onSearch: (queryOverride?: string) => void;
  onClear: () => void;
}

const isMac = typeof navigator !== "undefined" && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);

const SAMPLE_KEYWORDS = [
  "Invoice",
  "Receipt",
  "Tax",
  "Statement",
  "Contract",
  "Resume",
  "Ticket",
  "Screenshot",
];

export function SearchView({
  ftsQuery,
  setFtsQuery,
  ftsResults,
  isSearching,
  hasSearched,
  onSearch,
  onClear,
}: SearchViewProps) {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [openedPath, setOpenedPath] = useState<string | null>(null);
  const [launchedPath, setLaunchedPath] = useState<string | null>(null);
  const [previewItem, setPreviewItem] = useState<FtsResultItem | null>(null);

  const getEffectivePath = (item: FtsResultItem): string => {
    if (item.new_path && (item.status === "moved" || item.status === "copied")) {
      return item.new_path;
    }
    return item.path;
  };

  const handleLaunchFile = async (filePath: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!filePath) return;
    try {
      const res = await fetch(`${API_BASE}/fs/open-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, reveal: false }),
      });
      if (res.ok) {
        setLaunchedPath(filePath);
        setTimeout(() => setLaunchedPath(null), 2500);
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("Failed to open file directly:", errData);
      }
    } catch (err) {
      console.error("Failed to open file directly:", err);
    }
  };

  const handleOpenInExplorer = async (filePath: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!filePath) return;
    try {
      const res = await fetch(`${API_BASE}/fs/open-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, reveal: true }),
      });
      if (res.ok) {
        setOpenedPath(filePath);
        setTimeout(() => setOpenedPath(null), 2500);
      } else {
        const errData = await res.json().catch(() => ({}));
        console.error("Failed to open file in explorer:", errData);
      }
    } catch (err) {
      console.error("Failed to open file in explorer:", err);
    }
  };

  useEffect(() => {
    if (previewItem) {
      document.body.style.overflow = "hidden";
      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          setPreviewItem(null);
        }
      };
      window.addEventListener("keydown", handleKeyDown);
      return () => {
        document.body.style.overflow = "";
        window.removeEventListener("keydown", handleKeyDown);
      };
    }
  }, [previewItem]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onSearch();
    }
  };

  const handleSampleClick = (sample: string) => {
    setFtsQuery(sample);
    onSearch(sample);
  };

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path);
    setCopiedPath(path);
    setTimeout(() => {
      setCopiedPath(null);
    }, 2000);
  };

  return (
    <Screen className="max-w-[760px] mx-auto pt-8 px-4 pb-16">
      <StepHeader
        title="Find a file"
        subtitle="Search file names and the text inside documents, receipts and screenshots."
      />

      {/* Search field */}
      <div className="relative mt-6 flex items-center">
        <Search
          size={17}
          strokeWidth={1.75}
          className="text-tf-faint absolute left-3.5 pointer-events-none"
        />
        <input
          type="text"
          value={ftsQuery}
          onChange={(e) => setFtsQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search file names and contents..."
          className="w-full h-11 pl-10 pr-28 rounded-[8px] bg-tf-surface border border-tf-border-strong text-[14.5px] text-tf-ink placeholder:text-tf-faint focus:outline-none focus:border-tf-ink focus:ring-1 focus:ring-tf-ink transition-colors"
        />
        {ftsQuery && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            className="absolute right-20 text-tf-muted hover:text-tf-ink p-1 rounded cursor-pointer"
          >
            <X size={15} strokeWidth={1.75} />
          </button>
        )}
        <div className="absolute right-1.5">
          <Button
            variant="primary"
            size="sm"
            onClick={() => onSearch()}
            disabled={isSearching || !ftsQuery.trim()}
          >
            Search
          </Button>
        </div>
      </div>

      {/* Suggestions row */}
      <div className="flex flex-wrap items-center gap-1.5 mt-3 text-[12.5px]">
        <span className="text-tf-faint">Try:</span>
        {SAMPLE_KEYWORDS.map((sample) => (
          <button
            key={sample}
            type="button"
            onClick={() => handleSampleClick(sample)}
            className="h-7 px-2.5 rounded-[7px] border border-tf-border text-[12.5px] text-tf-ink-2 hover:bg-tf-surface-2 transition-colors cursor-pointer"
          >
            {sample}
          </button>
        ))}
      </div>

      {/* Skeletons while searching */}
      {isSearching && (
        <div className="mt-8">
          <Card className="divide-y divide-tf-border overflow-hidden">
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
        </div>
      )}

      {/* Empty state before searching */}
      {!isSearching && !hasSearched && ftsResults.length === 0 && (
        <div className="mt-14 text-center max-w-sm mx-auto space-y-2">
          <div className="w-10 h-10 rounded-[10px] border border-tf-border-strong bg-tf-surface grid place-items-center mx-auto text-tf-muted shadow-2xs">
            <Search size={20} strokeWidth={1.75} />
          </div>
          <h3 className="text-[14.5px] font-medium text-tf-ink">
            Search everything TidyFlow has sorted
          </h3>
          <p className="text-[13px] text-tf-muted">
            Search file names and the text inside documents, receipts and screenshots.
          </p>
        </div>
      )}

      {/* No results state */}
      {!isSearching && hasSearched && ftsResults.length === 0 && (
        <div className="mt-14 text-center max-w-sm mx-auto">
          <p className="text-[13px] text-tf-muted">No files match “{ftsQuery}”.</p>
        </div>
      )}

      {/* Results list */}
      {!isSearching && ftsResults.length > 0 && (
        <div className="mt-8 space-y-3">
          <div className="text-[12.5px] text-tf-muted tf-num">
            {ftsResults.length} {ftsResults.length === 1 ? "result" : "results"}
          </div>

          <Card className="divide-y divide-tf-border overflow-hidden">
            {ftsResults.map((item, idx) => {
              const fileName = item.path.split(/[\\/]/).pop() || item.path;
              const itemKey = `${item.id || idx}_${item.path}`;
              const snippetHtml = item.snippet || item.extracted_text || "";
              const extension = item.extension || (fileName.includes(".") ? "." + fileName.split(".").pop() : "");
              const effectivePath = getEffectivePath(item);
              const isCopied = copiedPath === item.path;
              const isLaunched = launchedPath === effectivePath;
              const isOpened = openedPath === effectivePath;

              return (
                <div
                  key={itemKey}
                  className="px-4 py-3 flex gap-3.5 items-start hover:bg-tf-surface-2/50 group transition-colors"
                >
                  <button
                    type="button"
                    onClick={() => setPreviewItem(item)}
                    className="cursor-pointer shrink-0"
                    title="Preview details"
                    aria-label={`Preview ${fileName}`}
                  >
                    <FilePreview
                      extension={extension}
                      fileCategory={item.category}
                      thumbnailB64={item.thumbnail_b64}
                      size={36}
                    />
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="text-[13.5px] font-medium text-tf-ink truncate">
                      {fileName}
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
                      <span
                        className="font-mono text-[12px] text-tf-faint truncate min-w-0"
                        title={item.path}
                      >
                        {item.path}
                      </span>
                    </div>

                    {snippetHtml ? (
                      <div
                        className="text-[12.5px] text-tf-ink-2 line-clamp-2 mt-1 leading-relaxed [&_mark]:bg-tf-warn-soft [&_mark]:text-tf-ink [&_mark]:rounded-[3px] [&_mark]:px-0.5"
                        dangerouslySetInnerHTML={{ __html: snippetHtml }}
                      />
                    ) : null}
                  </div>

                  {/* Actions on hover/focus */}
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <button
                      type="button"
                      onClick={() => handleCopyPath(item.path)}
                      className="w-7 h-7 rounded-[7px] flex items-center justify-center text-tf-muted hover:text-tf-ink hover:bg-tf-surface-2 transition-colors cursor-pointer"
                      title={`Copy path: ${item.path}`}
                      aria-label="Copy file path"
                    >
                      {isCopied ? (
                        <Check size={15} strokeWidth={1.75} className="text-tf-success" />
                      ) : (
                        <Copy size={15} strokeWidth={1.75} />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleLaunchFile(effectivePath, e)}
                      className="w-7 h-7 rounded-[7px] flex items-center justify-center text-tf-muted hover:text-tf-ink hover:bg-tf-surface-2 transition-colors cursor-pointer"
                      title="Open file"
                      aria-label="Open file"
                    >
                      {isLaunched ? (
                        <Check size={15} strokeWidth={1.75} className="text-tf-success" />
                      ) : (
                        <ExternalLink size={15} strokeWidth={1.75} />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={(e) => handleOpenInExplorer(effectivePath, e)}
                      className="w-7 h-7 rounded-[7px] flex items-center justify-center text-tf-muted hover:text-tf-ink hover:bg-tf-surface-2 transition-colors cursor-pointer"
                      title={isMac ? "Reveal in Finder" : "Reveal in File Explorer"}
                      aria-label={isMac ? "Reveal in Finder" : "Reveal in File Explorer"}
                    >
                      {isOpened ? (
                        <Check size={15} strokeWidth={1.75} className="text-tf-success" />
                      ) : (
                        <FolderOpen size={15} strokeWidth={1.75} />
                      )}
                    </button>

                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="w-7 h-7 rounded-[7px] flex items-center justify-center text-tf-muted hover:text-tf-ink hover:bg-tf-surface-2 transition-colors cursor-pointer"
                      title="Preview details"
                      aria-label="Preview file details"
                    >
                      <Eye size={15} strokeWidth={1.75} />
                    </button>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
      )}

      {/* Preview Modal */}
      {previewItem &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/40 backdrop-blur-xs z-[9999] flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setPreviewItem(null)}
          >
            <div
              className="bg-tf-surface border border-tf-border-strong rounded-[12px] max-w-2xl w-full max-h-[85vh] p-6 shadow-[var(--shadow-tf-float)] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between border-b border-tf-border pb-3.5 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <FilePreview
                    extension={previewItem.extension || "." + (previewItem.path.split(".").pop() || "")}
                    fileCategory={previewItem.category}
                    size={32}
                  />
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold text-tf-ink truncate">
                      {previewItem.path.split(/[\\/]/).pop() || previewItem.path}
                    </h3>
                    {previewItem.category && previewItem.category !== "Unknown" && (
                      <div className="text-[12px] text-tf-muted mt-0.5 flex items-center gap-1.5">
                        <FolderIcon name={previewItem.category} size={14} />
                        <span className="font-medium text-tf-ink-2">
                          {prettyFolderName(previewItem.category)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="w-7 h-7 rounded-[7px] flex items-center justify-center text-tf-muted hover:text-tf-ink hover:bg-tf-surface-2 transition-colors cursor-pointer"
                  title="Close preview (Esc)"
                  aria-label="Close preview"
                >
                  <X size={16} strokeWidth={1.75} />
                </button>
              </div>

              {/* Content */}
              <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-5 pt-4 min-h-0 overflow-hidden">
                <div className="md:col-span-6 bg-tf-surface-2 rounded-[8px] border border-tf-border flex items-center justify-center p-3 overflow-hidden">
                  {previewItem.thumbnail_b64 ? (
                    <img
                      src={`data:image/jpeg;base64,${previewItem.thumbnail_b64}`}
                      alt="Preview"
                      className="max-h-full max-w-full object-contain rounded-[6px] border border-tf-border-strong/60"
                    />
                  ) : (
                    <div className="text-center space-y-2 p-6">
                      <div className="w-10 h-10 rounded-[10px] border border-tf-border-strong bg-tf-surface grid place-items-center mx-auto text-tf-muted">
                        <FileText size={20} strokeWidth={1.75} />
                      </div>
                      <p className="text-[12.5px] text-tf-muted">
                        No image preview available for this file type.
                      </p>
                    </div>
                  )}
                </div>

                <div className="md:col-span-6 flex flex-col space-y-3 min-h-0 overflow-y-auto">
                  <div className="bg-tf-surface-2 p-3 rounded-[8px] border border-tf-border space-y-1.5 shrink-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-tf-muted">
                      Location
                    </div>
                    <p
                      className="font-mono text-[12px] text-tf-ink-2 truncate"
                      title={previewItem.path}
                    >
                      {previewItem.path}
                    </p>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<ExternalLink size={14} />}
                        onClick={() => handleLaunchFile(getEffectivePath(previewItem))}
                      >
                        {launchedPath === getEffectivePath(previewItem) ? "Opened" : "Open"}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={<FolderOpen size={14} />}
                        onClick={() => handleOpenInExplorer(getEffectivePath(previewItem))}
                      >
                        {openedPath === getEffectivePath(previewItem) ? "Revealed" : (isMac ? "Finder" : "Explorer")}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        icon={copiedPath === previewItem.path ? <Check size={14} /> : <Copy size={14} />}
                        onClick={() => handleCopyPath(previewItem.path)}
                      >
                        {copiedPath === previewItem.path ? "Copied" : "Copy"}
                      </Button>
                    </div>
                  </div>

                  {previewItem.reason && (
                    <div className="bg-tf-surface-2 p-3 rounded-[8px] border border-tf-border space-y-1 shrink-0">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-tf-muted">
                        Why it's in this folder
                      </div>
                      <p className="text-[12.5px] text-tf-ink-2 leading-relaxed">
                        {previewItem.reason}
                      </p>
                    </div>
                  )}

                  {previewItem.extracted_text && (
                    <div className="flex-1 flex flex-col min-h-[120px] space-y-1">
                      <div className="text-[11px] font-semibold uppercase tracking-wider text-tf-muted">
                        Words found inside file
                      </div>
                      <div className="flex-1 text-[12px] text-tf-ink-2 bg-tf-surface-2 p-3 rounded-[8px] border border-tf-border whitespace-pre-wrap overflow-y-auto leading-relaxed font-mono">
                        {previewItem.extracted_text}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between pt-4 border-t border-tf-border shrink-0 mt-3">
                <span className="text-[12px] text-tf-muted">
                  Press Esc to close
                </span>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => setPreviewItem(null)}
                >
                  Close
                </Button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </Screen>
  );
}
