import React, { useState, useMemo } from "react";
import { createPortal } from "react-dom";
import { ClassifiedFile, RunSummary, CategoryItem } from "../types";
import { getStickerStyle, formatBytes } from "../utils/stickerTheme";
import {
  Search,
  CheckCircle2,
  FileText,
  Eye,
  X,
  Sparkles,
  Send,
  Loader2,
} from "lucide-react";

interface ReviewViewProps {
  files: ClassifiedFile[];
  categories: Record<string, CategoryItem>;
  summary: RunSummary | null;
  selectedFileIds: Set<string>;
  setSelectedFileIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  categoryOverrides: Record<string, string>;
  setCategoryOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  autoThreshold: number;
  outputFolder: string;
  moveMode: boolean;
  setMoveMode: (val: boolean) => void;
  isApplying: boolean;
  applyResultModal: { count: number; action: string; output_dir: string } | null;
  setApplyResultModal: (val: { count: number; action: string; output_dir: string } | null) => void;
  onApplyDecisions: () => Promise<void>;
  onNavigateToOrganize: () => void;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  files,
  categories,
  selectedFileIds,
  setSelectedFileIds,
  categoryOverrides,
  setCategoryOverrides,
  autoThreshold,
  moveMode,
  setMoveMode,
  isApplying,
  applyResultModal,
  setApplyResultModal,
  onApplyDecisions,
  onNavigateToOrganize,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterConfidence, setFilterConfidence] = useState<"all" | "high" | "review">("all");
  const [previewFile, setPreviewFile] = useState<ClassifiedFile | null>(null);
  const [aiCommand, setAiCommand] = useState("");
  const [isExecutingAi, setIsExecutingAi] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);

  const handleRunAiEdit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cmd = aiCommand.trim();
    if (!cmd || isExecutingAi) return;

    setIsExecutingAi(true);
    setAiFeedback(null);

    try {
      const res = await fetch("http://localhost:8000/ai/review-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          command: cmd,
          files: files.map((f) => ({
            file_id: f.file_id,
            filename: f.filename,
            extension: f.extension,
            category: categoryOverrides[f.file_id] || f.category,
            reason: f.reason,
          })),
          categories: Object.keys(categories),
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to process command");
      }

      const data = await res.json();
      if (data.category_overrides && Object.keys(data.category_overrides).length > 0) {
        setCategoryOverrides((prev) => ({
          ...prev,
          ...data.category_overrides,
        }));
      }
      setAiFeedback(data.message || "Updated files successfully.");
      setAiCommand("");
    } catch (err: any) {
      setAiFeedback(`Error: ${err.message}`);
    } finally {
      setIsExecutingAi(false);
    }
  };

  // Filtered files memo
  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      const activeCat = categoryOverrides[f.file_id] || f.category;
      if (filterCategory !== "all" && activeCat !== filterCategory) return false;
      if (filterConfidence === "high" && f.confidence < autoThreshold) return false;
      if (filterConfidence === "review" && f.confidence >= autoThreshold) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = f.filename.toLowerCase().includes(q);
        const matchesCat = activeCat.toLowerCase().includes(q);
        const matchesText = (f.extracted_text || "").toLowerCase().includes(q);
        const matchesReason = (f.reason || "").toLowerCase().includes(q);
        if (!matchesName && !matchesCat && !matchesText && !matchesReason) return false;
      }
      return true;
    });
  }, [files, categoryOverrides, filterCategory, filterConfidence, searchQuery, autoThreshold]);

  const uniqueCategories = useMemo(() => {
    const set = new Set<string>();
    files.forEach((f) => {
      const cat = categoryOverrides[f.file_id] || f.category;
      if (cat) set.add(cat);
    });
    return Array.from(set).sort();
  }, [files, categoryOverrides]);

  const toggleSelect = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      filteredFiles.forEach((f) => next.add(f.file_id));
      return next;
    });
  };

  const deselectAllFiltered = () => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      filteredFiles.forEach((f) => next.delete(f.file_id));
      return next;
    });
  };

  const allFilteredSelected =
    filteredFiles.length > 0 && filteredFiles.every((f) => selectedFileIds.has(f.file_id));

  return (
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-24">
      {/* Header Bar */}
      <div className="border-b border-[#e6e6e6] dark:border-[#2e2e2e] pb-4">
        <div className="flex items-center gap-2 text-[13px] text-[#615d59] dark:text-[#9b9a97] mb-1 font-medium">
          <span>Workspace</span>
          <span>/</span>
          <span className="text-[#000000] dark:text-[#ffffff]">Review & Apply</span>
        </div>
        <h2 className="text-3xl font-bold text-[#000000] dark:text-[#ffffff] tracking-heading-1">
          Review & Apply
        </h2>
        <p className="text-[15px] text-[#615d59] dark:text-[#9b9a97] mt-1">
          Inspect predictions, reassign categories directly, and batch organize files.
        </p>
      </div>

      {/* 4 Metric Strip Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-[#ffffff] dark:bg-[#202020] p-4 rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          <p className="text-[12px] font-semibold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97]">
            Total Scanned
          </p>
          <p className="text-2xl font-bold text-[#000000] dark:text-[#ffffff] mt-1">{files.length}</p>
        </div>

        <div className="bg-[#ffffff] dark:bg-[#202020] p-4 rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          <p className="text-[12px] font-semibold uppercase tracking-eyebrow text-[#0075de] dark:text-[#2383e2]">
            Selected to Apply
          </p>
          <p className="text-2xl font-bold text-[#0075de] dark:text-[#2383e2] mt-1">{selectedFileIds.size}</p>
        </div>

        <div className="bg-[#ffffff] dark:bg-[#202020] p-4 rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          <p className="text-[12px] font-semibold uppercase tracking-eyebrow text-[#166534] dark:text-[#4ade80]">
            High Confidence (≥{Math.round(autoThreshold * 100)}%)
          </p>
          <p className="text-2xl font-bold text-[#166534] dark:text-[#4ade80] mt-1">
            {files.filter((f) => f.confidence >= autoThreshold).length}
          </p>
        </div>

        <div className="bg-[#ffffff] dark:bg-[#202020] p-4 rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          <p className="text-[12px] font-semibold uppercase tracking-eyebrow text-[#dd5b00] dark:text-[#fb923c]">
            Needs Review
          </p>
          <p className="text-2xl font-bold text-[#dd5b00] dark:text-[#fb923c] mt-1">
            {files.filter((f) => f.confidence < autoThreshold).length}
          </p>
        </div>
      </div>

      {/* AI Quick Edit Command Bar */}
      <div className="bg-[#ffffff] dark:bg-[#202020] p-4 rounded-xl border border-[#0075de]/30 dark:border-[#2383e2]/40 shadow-[0_2px_8px_rgba(0,117,222,0.06)] space-y-3">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
          <span className="text-[13px] font-bold text-[#000000] dark:text-[#ffffff]">
            AI Edit Assistant
          </span>
          <span className="text-[11px] text-[#615d59] dark:text-[#9b9a97]">
            Ask AI in natural language to adjust categories or rename files in bulk
          </span>
        </div>

        <form onSubmit={handleRunAiEdit} className="flex gap-2 items-center">
          <div className="relative flex-1">
            <input
              type="text"
              value={aiCommand}
              onChange={(e) => setAiCommand(e.target.value)}
              placeholder="e.g. 'Move all invoice PDFs to Finance/Invoices', 'Set files containing tax to Taxes/2026'..."
              disabled={isExecutingAi}
              className="w-full bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3.5 py-2 text-[12px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:bg-[#ffffff] dark:focus:bg-[#191919]"
            />
          </div>

          <button
            type="submit"
            disabled={!aiCommand.trim() || isExecutingAi}
            className="px-4 py-2 bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] text-white text-[12px] font-semibold rounded-md shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-40 active:scale-97 transition"
          >
            {isExecutingAi ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Applying...</span>
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span>Apply Edit</span>
              </>
            )}
          </button>
        </form>

        {aiFeedback && (
          <div className="text-[12px] text-[#166534] dark:text-[#4ade80] bg-[#dcfce7] dark:bg-[#052e16] px-3 py-1.5 rounded-md border border-[#86efac] dark:border-[#166534] flex items-center justify-between animate-fade-in">
            <span>{aiFeedback}</span>
            <button
              onClick={() => setAiFeedback(null)}
              className="text-xs hover:underline cursor-pointer"
            >
              ✕
            </button>
          </div>
        )}
      </div>

      {/* Toolbar Bar */}
      <div className="bg-[#ffffff] dark:bg-[#202020] p-3.5 rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] flex flex-wrap items-center justify-between gap-3 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
        <div className="flex flex-wrap items-center gap-2.5 flex-1">
          {/* Search Input */}
          <div className="relative min-w-[220px] max-w-sm flex-1">
            <Search className="w-3.5 h-3.5 text-[#a39e98] absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter file names, reasons, content..."
              className="w-full bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md pl-8 pr-7 py-1.5 text-[12px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:bg-[#ffffff] dark:focus:bg-[#191919]"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-2.5 top-2 text-[#a39e98] hover:text-[#000000] dark:hover:text-[#ffffff] text-xs cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Category Dropdown */}
          <div className="relative">
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className="bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3 py-1.5 text-[12px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] cursor-pointer"
            >
              <option value="all">All Categories ({files.length})</option>
              {uniqueCategories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          {/* Confidence Dropdown */}
          <select
            value={filterConfidence}
            onChange={(e) => setFilterConfidence(e.target.value as any)}
            className="bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3 py-1.5 text-[12px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] cursor-pointer"
          >
            <option value="all">All Confidence Scores</option>
            <option value="high">High Confidence (≥{Math.round(autoThreshold * 100)}%)</option>
            <option value="review">Needs Review (&lt;{Math.round(autoThreshold * 100)}%)</option>
          </select>
        </div>

        {/* Selection Quick Actions */}
        <div className="flex items-center gap-2">
          <button
            onClick={selectAllFiltered}
            className="px-3 py-1 text-[12px] font-medium bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] text-[#000000] dark:text-[#ffffff] rounded-md border border-[#e6e6e6] dark:border-[#383838] transition cursor-pointer"
          >
            Select Filtered ({filteredFiles.length})
          </button>
          <button
            onClick={deselectAllFiltered}
            className="px-3 py-1 text-[12px] font-medium text-[#615d59] dark:text-[#9b9a97] hover:text-[#000000] dark:hover:text-[#ffffff] hover:bg-[#f6f5f4] dark:hover:bg-[#282828] rounded-md border border-[#e6e6e6] dark:border-[#383838] transition cursor-pointer"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Files Table */}
      {filteredFiles.length === 0 ? (
        <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-12 text-center space-y-3 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-[#f6f5f4] dark:bg-[#282828] text-[#615d59] dark:text-[#9b9a97] mx-auto flex items-center justify-center text-xl">
            📂
          </div>
          <h3 className="text-base font-bold text-[#000000] dark:text-[#ffffff]">No files match your query</h3>
          <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97] max-w-md mx-auto">
            {files.length === 0
              ? "Run the pipeline from the 'Organize' tab to scan and classify your folder."
              : "Try clearing search keywords or category filters above."}
          </p>
          {files.length === 0 && (
            <button
              onClick={onNavigateToOrganize}
              className="mt-2 px-5 py-2 bg-[#0075de] dark:bg-[#2383e2] text-white text-[13px] font-semibold rounded-full shadow-xs cursor-pointer"
            >
              Go to Pipeline Runner
            </button>
          )}
        </div>
      ) : (
        <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[13px] border-collapse">
              <thead>
                <tr className="bg-[#f6f5f4] dark:bg-[#191919] border-b border-[#e6e6e6] dark:border-[#2e2e2e] text-[#615d59] dark:text-[#9b9a97] font-semibold text-[11px] uppercase tracking-eyebrow">
                  <th className="p-3 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={(e) => {
                        if (e.target.checked) selectAllFiltered();
                        else deselectAllFiltered();
                      }}
                      className="w-4 h-4 rounded text-[#0075de] dark:text-[#2383e2] focus:ring-[#0075de] cursor-pointer accent-[#0075de]"
                    />
                  </th>
                  <th className="p-3">File Name & Preview</th>
                  <th className="p-3 w-24">Size</th>
                  <th className="p-3 min-w-[200px]">Assigned Category (Editable)</th>
                  <th className="p-3 w-32">Confidence</th>
                  <th className="p-3">Match Summary</th>
                  <th className="p-3 w-12 text-center">View</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#e6e6e6] dark:divide-[#2e2e2e]">
                {filteredFiles.map((file) => {
                  const isSelected = selectedFileIds.has(file.file_id);
                  const currentCat = categoryOverrides[file.file_id] || file.category;
                  const isHighConf = file.confidence >= autoThreshold;
                  const catStyle = getStickerStyle(currentCat);

                  return (
                    <tr
                      key={file.file_id}
                      className={`hover:bg-[#f6f5f4]/80 dark:hover:bg-[#282828]/60 transition-colors ${
                        isSelected ? "bg-[#e8f4fd]/40 dark:bg-[#0c3966]/20" : ""
                      }`}
                    >
                      {/* Checkbox */}
                      <td className="p-3 text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(file.file_id)}
                          className="w-4 h-4 rounded text-[#0075de] dark:text-[#2383e2] focus:ring-[#0075de] cursor-pointer accent-[#0075de]"
                        />
                      </td>

                      {/* File Icon & Name */}
                      <td className="p-3">
                        <div className="flex items-center gap-3">
                          {file.thumbnail_b64 ? (
                            <img
                              src={`data:image/jpeg;base64,${file.thumbnail_b64}`}
                              alt="thumb"
                              className="w-9 h-9 object-cover rounded-md border border-[#e6e6e6] dark:border-[#383838] shadow-2xs"
                            />
                          ) : (
                            <div className="w-9 h-9 rounded-md bg-[#f6f5f4] dark:bg-[#282828] border border-[#e6e6e6] dark:border-[#383838] flex items-center justify-center font-mono text-[10px] font-bold text-[#615d59] dark:text-[#9b9a97] uppercase">
                              {file.extension.replace(".", "") || "FILE"}
                            </div>
                          )}

                          <div className="min-w-0 max-w-sm">
                            <p className="font-semibold text-[#000000] dark:text-[#ffffff] font-mono text-[12px] truncate">
                              {file.filename}
                            </p>
                            {file.suggested_filename && file.suggested_filename !== file.filename && (
                              <p className="text-[11px] text-[#0075de] dark:text-[#2383e2] font-mono truncate mt-0.5">
                                ↳ Rename: {file.suggested_filename}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>

                      {/* File Size */}
                      <td className="p-3 text-[#615d59] dark:text-[#9b9a97] font-mono text-[12px]">
                        {formatBytes(file.file_size_bytes)}
                      </td>

                      {/* Category Selector */}
                      <td className="p-3">
                        <div className="inline-flex items-center">
                          <select
                            value={currentCat}
                            onChange={(e) => {
                              setCategoryOverrides((prev) => ({
                                ...prev,
                                [file.file_id]: e.target.value,
                              }));
                            }}
                            className={`px-2.5 py-1 rounded-md text-[12px] font-medium font-mono border focus:outline-none focus:ring-1 focus:ring-[#0075de] dark:focus:ring-[#2383e2] cursor-pointer ${catStyle.bg} ${catStyle.text} ${catStyle.border}`}
                          >
                            {Object.keys(categories).map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                            {!categories[currentCat] && (
                              <option value={currentCat}>{currentCat}</option>
                            )}
                          </select>
                        </div>
                      </td>

                      {/* Confidence Meter */}
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-12 bg-[#e6e6e6] dark:bg-[#333333] rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                isHighConf ? "bg-[#1aae39] dark:bg-[#4ade80]" : "bg-[#dd5b00] dark:bg-[#fb923c]"
                              }`}
                              style={{ width: `${Math.round(file.confidence * 100)}%` }}
                            />
                          </div>
                          <span
                            className={`px-1.5 py-0.5 rounded text-[11px] font-bold font-mono ${
                              isHighConf
                                ? "bg-[#ecf7ed] dark:bg-[#0c3917]/40 text-[#166534] dark:text-[#4ade80]"
                                : "bg-[#fef3eb] dark:bg-[#4a1c07]/40 text-[#9a3412] dark:text-[#fb923c]"
                            }`}
                          >
                            {Math.round(file.confidence * 100)}%
                          </span>
                        </div>
                      </td>

                      {/* Match Summary */}
                      <td className="p-3 max-w-xs">
                        <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] line-clamp-1">
                          {file.reason || "Matched by rule / keyword"}
                        </p>
                        {file.near_duplicate_group_id && (
                          <span className="inline-block mt-0.5 text-[10px] text-[#9a3412] dark:text-[#fb923c] bg-[#fef3eb] dark:bg-[#4a1c07]/40 border border-[#dd5b00]/30 px-1.5 py-0.2 rounded font-mono">
                            ⚠️ Near-duplicate
                          </span>
                        )}
                      </td>

                      {/* Inspect Button */}
                      <td className="p-3 text-center">
                        <button
                          onClick={() => setPreviewFile(file)}
                          className="p-1 text-[#a39e98] hover:text-[#0075de] dark:hover:text-[#2383e2] hover:bg-[#e8f4fd] dark:hover:bg-[#0c3966]/40 rounded-md transition cursor-pointer"
                          title="Inspect document text"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Floating Action Bar */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 max-w-4xl w-[92%] bg-[#ffffff] dark:bg-[#202020] border border-[#e6e6e6] dark:border-[#333333] rounded-full px-6 py-3 shadow-[0_12px_35px_rgba(0,0,0,0.12)] dark:shadow-[0_12px_35px_rgba(0,0,0,0.6)] flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <span className="text-[13px] font-medium text-[#000000] dark:text-[#ffffff]">
            Ready to organize <strong className="text-[#0075de] dark:text-[#2383e2]">{selectedFileIds.size}</strong> of {files.length} files
          </span>

          <label className="flex items-center gap-2 cursor-pointer text-[12px] text-[#615d59] dark:text-[#9b9a97] border-l border-[#e6e6e6] dark:border-[#333333] pl-4">
            <input
              type="checkbox"
              checked={moveMode}
              onChange={(e) => setMoveMode(e.target.checked)}
              className="w-3.5 h-3.5 rounded text-[#dd5b00] accent-[#dd5b00] cursor-pointer"
            />
            <span>Move files (Default is safe Copy)</span>
          </label>
        </div>

        <button
          onClick={onApplyDecisions}
          disabled={isApplying || selectedFileIds.size === 0}
          className={`px-6 py-2 rounded-full font-semibold text-[13px] flex items-center gap-2 transition-all cursor-pointer ${
            isApplying || selectedFileIds.size === 0
              ? "bg-[#e6e6e6] dark:bg-[#333333] text-[#a39e98] cursor-not-allowed"
              : "bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] dark:hover:bg-[#1d70c2] text-white active:scale-97 shadow-[0_2px_8px_rgba(0,117,222,0.3)]"
          }`}
        >
          {isApplying ? (
            <span>Organizing Files...</span>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4" />
              <span>Apply & Organize Selected Files</span>
            </>
          )}
        </button>
      </div>

      {/* Document Text Preview Modal */}
      {previewFile &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 bg-[#000000]/60 backdrop-blur-xs z-[99999] flex items-center justify-center p-4"
            onClick={() => setPreviewFile(null)}
          >
            <div
              className="bg-[#ffffff] dark:bg-[#202020] rounded-2xl border border-[#e6e6e6] dark:border-[#333333] max-w-2xl w-full p-6 shadow-[0_20px_50px_rgba(0,0,0,0.25)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.8)] space-y-4 animate-fade-in max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[#e6e6e6] dark:border-[#333333] pb-3">
                <div className="flex items-center gap-2.5">
                  <FileText className="w-5 h-5 text-[#0075de] dark:text-[#2383e2]" />
                  <div>
                    <h3 className="text-[15px] font-bold text-[#000000] dark:text-[#ffffff] font-mono">
                      {previewFile.filename}
                    </h3>
                    <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97]">
                      {formatBytes(previewFile.file_size_bytes)} · Predicted Category:{" "}
                      <strong>{categoryOverrides[previewFile.file_id] || previewFile.category}</strong>
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setPreviewFile(null)}
                  className="p-1 rounded-md text-[#a39e98] hover:text-[#000000] dark:hover:text-[#ffffff] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 overflow-y-auto flex-1 pr-1">
                <div>
                  <h4 className="text-[11px] font-semibold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97] mb-1">
                    Classification Summary
                  </h4>
                  <p className="text-[13px] text-[#000000] dark:text-[#ffffff] bg-[#f6f5f4] dark:bg-[#191919] p-3 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e]">
                    {previewFile.reason || "Matched by keyword and file extension rules."}
                  </p>
                </div>

                {previewFile.extracted_text && (
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97] mb-1">
                      Extracted Text & OCR Content
                    </h4>
                    <pre className="text-[12px] font-mono text-[#31302e] dark:text-[#d4d4d4] bg-[#f6f5f4] dark:bg-[#191919] p-3 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e] whitespace-pre-wrap max-h-60 overflow-y-auto">
                      {previewFile.extracted_text}
                    </pre>
                  </div>
                )}
              </div>

              <div className="flex justify-end pt-3 border-t border-[#e6e6e6] dark:border-[#333333]">
                <button
                  onClick={() => setPreviewFile(null)}
                  className="px-5 py-2 bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] text-[#000000] dark:text-[#ffffff] text-[13px] font-semibold rounded-full cursor-pointer"
                >
                  Close
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Success Modal */}
      {applyResultModal &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 bg-[#000000]/60 backdrop-blur-xs z-[99999] flex items-center justify-center p-4"
            onClick={() => setApplyResultModal(null)}
          >
            <div
              className="bg-[#ffffff] dark:bg-[#202020] rounded-2xl border border-[#e6e6e6] dark:border-[#333333] max-w-md w-full p-6 shadow-[0_20px_50px_rgba(0,0,0,0.25)] dark:shadow-[0_20px_50px_rgba(0,0,0,0.8)] space-y-4 animate-fade-in text-center"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-14 h-14 rounded-full bg-[#ecf7ed] dark:bg-[#0c3917]/40 text-[#166534] dark:text-[#4ade80] mx-auto flex items-center justify-center text-2xl">
                ✓
              </div>
              <h3 className="text-xl font-bold text-[#000000] dark:text-[#ffffff]">
                Files Successfully Organized!
              </h3>
              <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
                <strong>{applyResultModal.count} files</strong> have been {applyResultModal.action} into organized subdirectories under:
              </p>
              <p className="text-[12px] font-mono bg-[#f6f5f4] dark:bg-[#191919] p-3 rounded-lg text-[#000000] dark:text-[#ffffff] break-all border border-[#e6e6e6] dark:border-[#2e2e2e]">
                {applyResultModal.output_dir}
              </p>
              <button
                onClick={() => setApplyResultModal(null)}
                className="w-full py-2.5 bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] dark:hover:bg-[#1d70c2] text-white font-semibold text-[13px] rounded-full shadow-xs cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
};
