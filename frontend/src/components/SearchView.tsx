import React, { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { FtsResultItem } from "../types";
import { API_BASE } from "../config";
import { getStickerStyle, formatBytes } from "../utils/stickerTheme";
import {
  Search,
  FileText,
  CornerDownLeft,
  X,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  FileSearch,
  Sparkles,
  Layers,
  Eye,
  ImageIcon,
  FolderOpen,
} from "lucide-react";

interface SearchViewProps {
  ftsQuery: string;
  setFtsQuery: (val: string) => void;
  ftsResults: FtsResultItem[];
  isSearching: boolean;
  hasSearched: boolean;
  onSearch: (queryOverride?: string) => void;
  onClear: () => void;
}

export const SearchView: React.FC<SearchViewProps> = ({
  ftsQuery,
  setFtsQuery,
  ftsResults,
  isSearching,
  hasSearched,
  onSearch,
  onClear,
}) => {
  const [copiedPath, setCopiedPath] = useState<string | null>(null);
  const [openedPath, setOpenedPath] = useState<string | null>(null);
  const [expandedFiles, setExpandedFiles] = useState<Record<string, boolean>>({});
  const [inlineThumbnails, setInlineThumbnails] = useState<Record<string, boolean>>({});
  const [previewItem, setPreviewItem] = useState<FtsResultItem | null>(null);

  const handleOpenInExplorer = async (filePath: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    try {
      const res = await fetch(`${API_BASE}/fs/open-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, reveal: true }),
      });
      if (res.ok) {
        setOpenedPath(filePath);
        setTimeout(() => setOpenedPath(null), 2000);
      }
    } catch (err) {
      console.error("Failed to open file in explorer:", err);
    }
  };

  // Lock body scroll and handle Escape key when preview modal is open
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

  const toggleExpand = (key: string) => {
    setExpandedFiles((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const toggleInlineThumb = (key: string) => {
    setInlineThumbnails((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const sampleKeywords = [
    "Invoice",
    "Receipt",
    "Tax",
    "Statement",
    "Agreement",
    "React",
    "Resume",
    "Course",
  ];

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      {/* Header Bar */}
      <div className="border-b border-[#e6e6e6] dark:border-[#2e2e2e] pb-4">
        <div className="flex items-center gap-2 text-[13px] text-[#615d59] dark:text-[#9b9a97] mb-1 font-medium">
          <span>Workspace</span>
          <span>/</span>
          <span className="text-[#000000] dark:text-[#ffffff]">Search</span>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-3xl font-bold text-[#000000] dark:text-[#ffffff] tracking-heading-1">
              Search Index
            </h2>
            <p className="text-[15px] text-[#615d59] dark:text-[#9b9a97] mt-1">
              Instant full-text OCR search across documents, receipts, invoices, and file paths.
            </p>
          </div>
          {ftsResults.length > 0 && (
            <span className="text-[12px] font-mono font-semibold px-2.5 py-1 rounded-full bg-[#0075de]/10 text-[#0075de] dark:bg-[#2383e2]/20 dark:text-[#58a6ff]">
              {ftsResults.length} {ftsResults.length === 1 ? "match" : "matches"}
            </span>
          )}
        </div>
      </div>

      {/* Search Input Card */}
      <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] space-y-3.5">
        <div className="flex gap-2.5 items-center">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#a39e98] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={ftsQuery}
              onChange={(e) => setFtsQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search across all extracted documents (e.g. invoice, total, React, resume, tax)..."
              className="w-full bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-lg pl-10 pr-10 py-2.5 text-[13px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:bg-[#ffffff] dark:focus:bg-[#191919] shadow-2xs transition"
            />
            {ftsQuery && (
              <button
                type="button"
                onClick={onClear}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#a39e98] hover:text-[#31302e] dark:hover:text-[#ffffff] p-1 rounded-md transition cursor-pointer"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            onClick={() => onSearch()}
            disabled={isSearching || !ftsQuery.trim()}
            className={`px-5 py-2.5 rounded-full text-[13px] font-semibold flex items-center gap-2 transition cursor-pointer shrink-0 ${
              isSearching || !ftsQuery.trim()
                ? "bg-[#e6e6e6] dark:bg-[#333333] text-[#a39e98] cursor-not-allowed"
                : "bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] text-white active:scale-97 shadow-xs"
            }`}
          >
            {isSearching ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                <span>Searching...</span>
              </>
            ) : (
              <>
                <span>Search Index</span>
                <CornerDownLeft className="w-3.5 h-3.5" />
              </>
            )}
          </button>
        </div>

        {/* Sample Queries Chips */}
        <div className="flex flex-wrap items-center gap-2 text-[12px] text-[#615d59] dark:text-[#9b9a97] pt-0.5">
          <span className="font-medium flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-[#0075de] dark:text-[#2383e2]" />
            Quick queries:
          </span>
          {sampleKeywords.map((sample) => (
            <button
              key={sample}
              onClick={() => handleSampleClick(sample)}
              className={`px-2.5 py-1 rounded-md border text-[11px] font-medium transition cursor-pointer active:scale-95 ${
                ftsQuery.toLowerCase() === sample.toLowerCase()
                  ? "bg-[#0075de]/10 border-[#0075de]/40 text-[#0075de] dark:bg-[#2383e2]/20 dark:border-[#2383e2]/50 dark:text-[#58a6ff]"
                  : "bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] text-[#31302e] dark:text-[#d4d4d4] border-[#e6e6e6] dark:border-[#383838]"
              }`}
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      {/* Searching Skeleton / Loading */}
      {isSearching && (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-5 space-y-3"
            >
              <div className="flex justify-between items-center">
                <div className="h-4 bg-[#e6e6e6] dark:bg-[#333333] rounded w-1/3" />
                <div className="h-4 bg-[#e6e6e6] dark:bg-[#333333] rounded w-20" />
              </div>
              <div className="h-3 bg-[#f0f0f0] dark:bg-[#282828] rounded w-2/3" />
              <div className="h-16 bg-[#f6f5f4] dark:bg-[#191919] rounded-lg" />
            </div>
          ))}
        </div>
      )}

      {/* Results Section */}
      {!isSearching && ftsResults.length > 0 && (
        <div className="space-y-3.5">
          <div className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97]">
            <span>Search Results ({ftsResults.length})</span>
            <span className="text-[11px] lowercase text-[#a39e98] font-normal">
              ranked by FTS relevance
            </span>
          </div>

          <div className="space-y-3">
            {ftsResults.map((item, idx) => {
              const fileName = item.path.split("/").pop() || item.path;
              const catStyle = getStickerStyle(item.category || "");
              const isCopied = copiedPath === item.path;
              const itemKey = `${item.id || idx}_${item.path}`;
              const isExpanded = !!expandedFiles[itemKey];
              const isInlineThumbOpen = !!inlineThumbnails[itemKey];
              const snippetHtml = item.snippet || item.extracted_text || "";
              const hasLongText = (item.extracted_text || "").length > 250;
              const extension = item.extension || (fileName.includes(".") ? "." + fileName.split(".").pop() : "");

              return (
                <div
                  key={itemKey}
                  className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-4.5 space-y-3 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] hover:border-[#a39e98] dark:hover:border-[#4a4a4a] transition duration-150"
                >
                  {/* File Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      {/* Thumbnail or File Badge with Preview Trigger */}
                      {item.thumbnail_b64 ? (
                        <button
                          type="button"
                          onClick={() => setPreviewItem(item)}
                          className="relative group shrink-0 cursor-pointer"
                          title="Click to view full preview"
                        >
                          <img
                            src={`data:image/jpeg;base64,${item.thumbnail_b64}`}
                            alt="thumbnail"
                            className="w-11 h-11 object-cover rounded-lg border border-[#e6e6e6] dark:border-[#383838] shadow-2xs group-hover:opacity-85 transition"
                          />
                          <div className="absolute inset-0 bg-black/30 rounded-lg opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-white">
                            <Eye className="w-3.5 h-3.5" />
                          </div>
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPreviewItem(item)}
                          className="w-11 h-11 rounded-lg bg-[#0075de]/10 dark:bg-[#2383e2]/20 border border-[#e6e6e6] dark:border-[#383838] flex flex-col items-center justify-center shrink-0 hover:bg-[#0075de]/20 transition cursor-pointer"
                          title="Click to inspect file text"
                        >
                          <FileText className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
                          <span className="font-mono text-[9px] font-bold text-[#615d59] dark:text-[#9b9a97] uppercase mt-0.5">
                            {extension ? extension.replace(".", "").slice(0, 4) : "FILE"}
                          </span>
                        </button>
                      )}

                      <div className="min-w-0">
                        <h4 className="font-semibold text-[13.5px] text-[#000000] dark:text-[#ffffff] font-mono truncate">
                          {fileName}
                        </h4>
                        <div className="flex items-center gap-1.5 text-[11px] text-[#615d59] dark:text-[#9b9a97] font-mono mt-0.5">
                          {item.file_size_bytes ? (
                            <span>{formatBytes(item.file_size_bytes)} · </span>
                          ) : null}
                          <span className="truncate max-w-md">{item.path}</span>
                          <button
                            type="button"
                            onClick={() => handleCopyPath(item.path)}
                            className="p-0.5 hover:text-[#000000] dark:hover:text-[#ffffff] rounded transition cursor-pointer"
                            title="Copy full file path"
                          >
                            {isCopied ? (
                              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <Copy className="w-3 h-3" />
                            )}
                          </button>
                          {isCopied && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-sans font-medium">
                              Copied!
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={(e) => handleOpenInExplorer(item.path, e)}
                            className="p-0.5 hover:text-[#0075de] dark:hover:text-[#2383e2] rounded transition cursor-pointer flex items-center gap-0.5 text-[10px] text-[#615d59] dark:text-[#9b9a97] hover:bg-[#f0eee9] dark:hover:bg-[#333333] px-1"
                            title="Open and reveal in Finder / File Explorer"
                          >
                            {openedPath === item.path ? (
                              <span className="text-emerald-600 dark:text-emerald-400 font-sans font-medium">Opened!</span>
                            ) : (
                              <>
                                <FolderOpen className="w-3 h-3 text-[#0075de] dark:text-[#2383e2]" />
                                <span>Reveal</span>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {item.confidence_score !== undefined && (
                        <span className="text-[11px] font-mono text-[#615d59] dark:text-[#9b9a97]">
                          {(item.confidence_score * 100).toFixed(0)}%
                        </span>
                      )}
                      {item.category && (
                        <span
                          className={`text-[11px] font-semibold px-2.5 py-0.5 rounded-md border font-mono ${catStyle.bg} ${catStyle.text} ${catStyle.border}`}
                        >
                          {item.category}
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => setPreviewItem(item)}
                        className="px-2.5 py-1 text-[11px] font-medium bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] text-[#0075de] dark:text-[#2383e2] rounded-md border border-[#e6e6e6] dark:border-[#383838] transition cursor-pointer flex items-center gap-1"
                        title="Open full preview inspector"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Preview</span>
                      </button>
                    </div>
                  </div>

                  {/* Inline Image Preview (if toggled) */}
                  {isInlineThumbOpen && item.thumbnail_b64 && (
                    <div className="p-3 bg-[#f6f5f4] dark:bg-[#151515] rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e] flex justify-center animate-fade-in">
                      <img
                        src={`data:image/jpeg;base64,${item.thumbnail_b64}`}
                        alt="inline preview"
                        className="max-h-60 max-w-full object-contain rounded-md shadow-xs"
                      />
                    </div>
                  )}

                  {/* Highlighted Match Snippet */}
                  {snippetHtml ? (
                    <div className="space-y-1.5">
                      <div
                        className="bg-[#f6f5f4] dark:bg-[#191919] p-3 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e] font-mono text-[12px] text-[#31302e] dark:text-[#d4d4d4] leading-relaxed whitespace-pre-wrap fts-snippet"
                        dangerouslySetInnerHTML={{
                          __html: isExpanded ? item.extracted_text || snippetHtml : snippetHtml,
                        }}
                      />

                      <div className="flex items-center gap-3 pt-0.5">
                        {item.thumbnail_b64 && (
                          <button
                            type="button"
                            onClick={() => toggleInlineThumb(itemKey)}
                            className="flex items-center gap-1 text-[11px] text-[#615d59] dark:text-[#9b9a97] hover:text-[#0075de] dark:hover:text-[#2383e2] font-medium cursor-pointer"
                          >
                            <ImageIcon className="w-3 h-3" />
                            <span>{isInlineThumbOpen ? "Hide image preview" : "View image preview"}</span>
                          </button>
                        )}

                        {hasLongText && (
                          <button
                            type="button"
                            onClick={() => toggleExpand(itemKey)}
                            className="flex items-center gap-1 text-[11px] text-[#0075de] dark:text-[#2383e2] hover:underline font-medium cursor-pointer"
                          >
                            {isExpanded ? (
                              <>
                                <ChevronUp className="w-3 h-3" />
                                <span>Show less text</span>
                              </>
                            ) : (
                              <>
                                <ChevronDown className="w-3 h-3" />
                                <span>Show full extracted text ({item.extracted_text?.length} chars)</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-[11px] text-[#a39e98] italic font-mono">
                      Matched by file path or category taxonomy.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Empty State after search */}
      {!isSearching && hasSearched && ftsResults.length === 0 && (
        <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-10 text-center space-y-4 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          <div className="w-12 h-12 rounded-full bg-[#f6f5f4] dark:bg-[#282828] border border-[#e6e6e6] dark:border-[#383838] flex items-center justify-center mx-auto text-[#615d59] dark:text-[#9b9a97]">
            <FileSearch className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h3 className="text-base font-semibold text-[#000000] dark:text-[#ffffff]">
              No matching documents found
            </h3>
            <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97] max-w-md mx-auto">
              No results found for <span className="font-semibold text-[#000000] dark:text-[#ffffff]">"{ftsQuery}"</span>.
              Try searching with partial words, different keywords, or check that documents have been processed in the Organize tab.
            </p>
          </div>
          <div className="flex justify-center gap-2 pt-1">
            {sampleKeywords.slice(0, 4).map((sample) => (
              <button
                key={sample}
                onClick={() => handleSampleClick(sample)}
                className="px-3 py-1 text-[11px] font-medium rounded-md bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] border border-[#e6e6e6] dark:border-[#383838] cursor-pointer"
              >
                Try "{sample}"
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Discovery / Initial State before search */}
      {!isSearching && !hasSearched && ftsResults.length === 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-5 space-y-2 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="w-8 h-8 rounded-lg bg-[#0075de]/10 dark:bg-[#2383e2]/20 flex items-center justify-center text-[#0075de] dark:text-[#2383e2]">
              <Search className="w-4 h-4" />
            </div>
            <h4 className="font-semibold text-[13px] text-[#000000] dark:text-[#ffffff]">
              Full-Text OCR Index
            </h4>
            <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
              Search inside receipts, invoices, PDF documents, and screenshots using native OCR text extraction.
            </p>
          </div>

          <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-5 space-y-2 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="w-8 h-8 rounded-lg bg-[#0075de]/10 dark:bg-[#2383e2]/20 flex items-center justify-center text-[#0075de] dark:text-[#2383e2]">
              <FileText className="w-4 h-4" />
            </div>
            <h4 className="font-semibold text-[13px] text-[#000000] dark:text-[#ffffff]">
              File Names & Paths
            </h4>
            <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
              Query file extensions, nested directories, dates, and names instantly using tokenized FTS5 matching.
            </p>
          </div>

          <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-5 space-y-2 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
            <div className="w-8 h-8 rounded-lg bg-[#0075de]/10 dark:bg-[#2383e2]/20 flex items-center justify-center text-[#0075de] dark:text-[#2383e2]">
              <Layers className="w-4 h-4" />
            </div>
            <h4 className="font-semibold text-[13px] text-[#000000] dark:text-[#ffffff]">
              Category Filtering
            </h4>
            <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
              Quickly find classified items by category name, tax tags, finance groups, or custom user taxonomies.
            </p>
          </div>
        </div>
      )}

      {/* Modern 2-Column Split Preview Inspector Modal rendered in document.body Portal */}
      {previewItem &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 bg-[#000000]/70 backdrop-blur-xs z-[99999] flex items-center justify-center p-4 sm:p-6"
            onClick={() => setPreviewItem(null)}
          >
            <div
              className="bg-[#ffffff] dark:bg-[#1f1f1f] rounded-2xl border border-[#e6e6e6] dark:border-[#333333] max-w-4xl w-full h-[85vh] max-h-[640px] p-5 sm:p-6 shadow-[0_25px_60px_rgba(0,0,0,0.4)] dark:shadow-[0_25px_60px_rgba(0,0,0,0.9)] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center justify-between border-b border-[#e6e6e6] dark:border-[#333333] pb-3.5 shrink-0">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-[#0075de]/10 dark:bg-[#2383e2]/20 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-[#0075de] dark:text-[#2383e2]" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-bold text-[#000000] dark:text-[#ffffff] font-mono truncate">
                      {previewItem.path.split("/").pop() || previewItem.path}
                    </h3>
                    <div className="flex items-center gap-2 text-[12px] text-[#615d59] dark:text-[#9b9a97] mt-0.5">
                      {previewItem.file_size_bytes ? (
                        <span>{formatBytes(previewItem.file_size_bytes)} · </span>
                      ) : null}
                      <span>
                        Category:{" "}
                        <strong className="text-[#000000] dark:text-[#ffffff]">
                          {previewItem.category || "Unknown"}
                        </strong>
                      </span>
                      {previewItem.confidence_score !== undefined && (
                        <span className="font-mono">
                          ({(previewItem.confidence_score * 100).toFixed(0)}%)
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="p-1.5 rounded-lg text-[#a39e98] hover:text-[#000000] dark:hover:text-[#ffffff] hover:bg-[#f6f5f4] dark:hover:bg-[#282828] transition cursor-pointer"
                  title="Close preview (Esc)"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Modal 2-Column Split Content */}
              <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-5 pt-4 min-h-0 overflow-hidden">
                {/* Left Column: Visual Image / PDF Canvas */}
                <div className="md:col-span-7 bg-[#f6f5f4] dark:bg-[#141414] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] flex flex-col items-center justify-center p-3 relative overflow-hidden h-full">
                  {previewItem.thumbnail_b64 ? (
                    <div className="w-full h-full flex items-center justify-center overflow-auto p-2">
                      <img
                        src={`data:image/jpeg;base64,${previewItem.thumbnail_b64}`}
                        alt="Document Preview"
                        className="max-h-full max-w-full object-contain rounded-lg shadow-md border border-[#e6e6e6] dark:border-[#2e2e2e]"
                      />
                    </div>
                  ) : (
                    <div className="text-center space-y-2 p-6">
                      <div className="w-14 h-14 rounded-2xl bg-[#ffffff] dark:bg-[#222222] border border-[#e6e6e6] dark:border-[#383838] flex items-center justify-center mx-auto text-[#0075de] dark:text-[#2383e2]">
                        <FileText className="w-7 h-7" />
                      </div>
                      <p className="font-mono text-[13px] font-semibold text-[#000000] dark:text-[#ffffff]">
                        {previewItem.path.split("/").pop()}
                      </p>
                      <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97]">
                        Visual thumbnail not available for this file type.
                      </p>
                    </div>
                  )}
                </div>

                {/* Right Column: Metadata & Extracted Text Inspector */}
                <div className="md:col-span-5 flex flex-col space-y-3.5 min-h-0 overflow-y-auto pr-1">
                  {/* File Path & Copy */}
                  <div className="bg-[#f6f5f4] dark:bg-[#191919] p-3 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e] space-y-1.5 shrink-0">
                    <div className="flex items-center justify-between">
                      <span className="text-[11px] font-semibold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97]">
                        File Path
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleCopyPath(previewItem.path)}
                          className="text-[11px] font-semibold text-[#615d59] dark:text-[#9b9a97] hover:text-[#000000] dark:hover:text-[#ffffff] flex items-center gap-1 cursor-pointer"
                        >
                          {copiedPath === previewItem.path ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                              <span className="text-emerald-600 dark:text-emerald-400">Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenInExplorer(previewItem.path)}
                          className="text-[11px] font-semibold text-[#0075de] dark:text-[#2383e2] hover:underline flex items-center gap-1 cursor-pointer bg-[#0075de]/10 dark:bg-[#2383e2]/15 px-2 py-0.5 rounded border border-[#0075de]/20"
                          title="Open and reveal file in Finder / File Explorer"
                        >
                          <FolderOpen className="w-3 h-3" />
                          <span>{openedPath === previewItem.path ? "Opened!" : "Reveal in Finder"}</span>
                        </button>
                      </div>
                    </div>
                    <p className="font-mono text-[11px] text-[#31302e] dark:text-[#d4d4d4] break-all leading-relaxed">
                      {previewItem.path}
                    </p>
                  </div>

                  {/* Classification Details */}
                  {previewItem.reason && (
                    <div className="bg-[#f6f5f4] dark:bg-[#191919] p-3 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e] space-y-1 shrink-0">
                      <span className="text-[11px] font-semibold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97]">
                        Classification Reason
                      </span>
                      <p className="text-[12px] text-[#000000] dark:text-[#ffffff] leading-relaxed">
                        {previewItem.reason}
                      </p>
                    </div>
                  )}

                  {/* Extracted Text & OCR */}
                  <div className="flex-1 flex flex-col min-h-[140px] space-y-1">
                    <span className="text-[11px] font-semibold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97]">
                      Extracted OCR & Body Text ({previewItem.extracted_text?.length || 0} chars)
                    </span>
                    <div className="flex-1 font-mono text-[11.5px] text-[#31302e] dark:text-[#d4d4d4] bg-[#f6f5f4] dark:bg-[#191919] p-3 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e] whitespace-pre-wrap overflow-y-auto leading-relaxed fts-snippet">
                      {previewItem.extracted_text || "No text content extracted from this document."}
                    </div>
                  </div>
                </div>
              </div>

              {/* Modal Footer */}
              <div className="flex items-center justify-between pt-3 border-t border-[#e6e6e6] dark:border-[#333333] shrink-0 mt-3">
                <span className="text-[11px] text-[#a39e98] font-mono">
                  Press{" "}
                  <kbd className="px-1.5 py-0.5 bg-[#f6f5f4] dark:bg-[#282828] border border-[#e6e6e6] dark:border-[#383838] rounded text-[10px]">
                    Esc
                  </kbd>{" "}
                  to close
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="px-5 py-1.5 bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] text-[#000000] dark:text-[#ffffff] text-[13px] font-semibold rounded-full cursor-pointer transition"
                >
                  Close Preview
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
