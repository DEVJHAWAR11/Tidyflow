import React, { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import {
  Sparkles,
  ChevronLeft,
  ChevronRight,
  Check,
  FolderPlus,
  FileText,
  Image as ImageIcon,
  Archive,
  Code,
  X,
  Keyboard,
  CheckCircle2,
  SkipForward,
} from "lucide-react";
import { ClassifiedFile } from "../types";

interface QuickTriageModalProps {
  files: ClassifiedFile[];
  categories: string[];
  categoryOverrides: Record<string, string>;
  onAssignCategory: (fileId: string, category: string, autoSelect?: boolean) => void;
  onClose: () => void;
}

export const QuickTriageModal: React.FC<QuickTriageModalProps> = ({
  files,
  categories,
  categoryOverrides,
  onAssignCategory,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [customFolder, setCustomFolder] = useState("");
  const [showFullText, setShowFullText] = useState(false);
  const [localCategories, setLocalCategories] = useState<string[]>(() => Array.from(new Set(categories)));

  // Sync with incoming categories prop while preserving any newly added local categories
  useEffect(() => {
    setLocalCategories((prev) => {
      const merged = new Set([...prev, ...categories]);
      return Array.from(merged);
    });
  }, [categories]);

  // Queue of unclassified or low-confidence files
  const queue = files;
  const currentFile = queue[currentIndex];

  const currentAssignedCat = currentFile
    ? categoryOverrides[currentFile.file_id] || (currentFile.category !== "Unknown" ? currentFile.category : null)
    : null;

  const handleAssign = useCallback(
    (catName: string) => {
      if (!currentFile) return;
      onAssignCategory(currentFile.file_id, catName, true);

      // Auto advance to next
      if (currentIndex < queue.length - 1) {
        setCurrentIndex((prev) => prev + 1);
        setShowFullText(false);
      }
    },
    [currentFile, currentIndex, queue.length, onAssignCategory]
  );

  const handleSkip = useCallback(() => {
    if (currentIndex < queue.length - 1) {
      setCurrentIndex((prev) => prev + 1);
      setShowFullText(false);
    }
  }, [currentIndex, queue.length]);

  const handlePrev = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
      setShowFullText(false);
    }
  }, [currentIndex]);

  const handleCustomFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const folder = customFolder.trim().replace(/^[\/\\]+|[\/\\]+$/g, "");
    if (!folder) return;
    if (!localCategories.includes(folder)) {
      setLocalCategories((prev) => [...prev, folder]);
    }
    handleAssign(folder);
    setCustomFolder("");
  };

  // Keyboard shortcut listener
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't intercept if typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        if (e.key === "Escape") {
          (e.target as HTMLElement).blur();
        }
        return;
      }

      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowRight") {
        handleSkip();
      } else if (e.key === "ArrowLeft") {
        handlePrev();
      } else if (e.key === " " || e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSkip();
      } else {
        // Number keys 1-9 for quick category selection
        const num = parseInt(e.key, 10);
        if (!isNaN(num) && num >= 1 && num <= Math.min(localCategories.length, 9)) {
          e.preventDefault();
          const targetCategory = localCategories[num - 1];
          if (targetCategory) {
            handleAssign(targetCategory);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [localCategories, handleAssign, handleSkip, handlePrev, onClose]);

  if (!currentFile || queue.length === 0) {
    if (typeof document === "undefined") return null;
    return createPortal(
      <div className="fixed inset-0 z-[99999] bg-black/60 dark:bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
        <div className="bg-[#ffffff] dark:bg-[#202020] rounded-2xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-8 max-w-md w-full text-center space-y-4 shadow-2xl animate-scale-in">
          <div className="w-14 h-14 rounded-full bg-[#dcfce7] dark:bg-[#052e16] text-[#166534] dark:text-[#4ade80] flex items-center justify-center mx-auto text-2xl">
            <CheckCircle2 className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-bold text-[#000000] dark:text-[#ffffff]">
            Triage Queue Empty!
          </h3>
          <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97]">
            All unrecognized files have been triaged or reviewed.
          </p>
          <button
            onClick={onClose}
            className="w-full py-2.5 bg-[#1d1d1f] hover:bg-[#000000] dark:bg-[#ffffff] dark:hover:bg-[#f0f0f0] text-white dark:text-[#000000] font-semibold rounded-xl transition cursor-pointer"
          >
            Return to Review Table
          </button>
        </div>
      </div>,
      document.body
    );
  }

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getFileIcon = () => {
    const ext = currentFile.extension.toLowerCase();
    if (currentFile.thumbnail_b64 || [".jpg", ".jpeg", ".png", ".webp", ".heic"].includes(ext)) {
      return <ImageIcon className="w-5 h-5 text-purple-500" />;
    }
    if ([".zip", ".tar", ".gz", ".7z", ".dmg"].includes(ext)) {
      return <Archive className="w-5 h-5 text-amber-500" />;
    }
    if ([".py", ".ts", ".js", ".html", ".css", ".sql", ".sh"].includes(ext)) {
      return <Code className="w-5 h-5 text-emerald-500" />;
    }
    return <FileText className="w-5 h-5 text-blue-500" />;
  };

  const progressPercent = Math.round(((currentIndex + 1) / queue.length) * 100);

  return createPortal(
    <div className="fixed inset-0 z-[99999] bg-black/60 dark:bg-black/80 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 animate-fade-in">
      <div className="bg-[#ffffff] dark:bg-[#1a1a1a] rounded-2xl border border-[#e6e6e6] dark:border-[#2e2e2e] w-full max-w-4xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden animate-scale-in">
        {/* Top Header & Progress */}
        <div className="p-4 sm:p-5 border-b border-[#e6e6e6] dark:border-[#2e2e2e] flex items-center justify-between gap-4 bg-[#faf9f8] dark:bg-[#202020]">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-[#0075de]/10 dark:bg-[#2383e2]/20 text-[#0075de] dark:text-[#2383e2]">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#000000] dark:text-[#ffffff]">
                  Quick Triage Queue
                </h3>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#e8f4fd] dark:bg-[#0c3966]/40 text-[#0075de] dark:text-[#2383e2]">
                  {currentIndex + 1} of {queue.length}
                </span>
              </div>
              <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97]">
                Quickly sort unclassified files into folders with 1-click or number shortcuts.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Keyboard Shortcuts Pill */}
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#ffffff] dark:bg-[#151515] border border-[#e6e6e6] dark:border-[#333333] text-[11px] text-[#615d59] dark:text-[#9b9a97]">
              <Keyboard className="w-3.5 h-3.5" />
              <span>[1-9] Assign</span>
              <span>•</span>
              <span>[Space] Skip</span>
              <span>•</span>
              <span>[←/→] Navigate</span>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#615d59] dark:text-[#9b9a97] hover:text-[#000000] dark:hover:text-[#ffffff] hover:bg-[#eae8e5] dark:hover:bg-[#2e2e2e] transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-[#f0eee9] dark:bg-[#252525] h-1.5">
          <div
            className="bg-[#0075de] dark:bg-[#2383e2] h-1.5 transition-all duration-300 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left: Preview Panel (7 Cols) */}
          <div className="lg:col-span-7 space-y-4 flex flex-col">
            <div className="bg-[#f6f5f4] dark:bg-[#222222] rounded-xl border border-[#e6e6e6] dark:border-[#303030] p-4 flex-1 flex flex-col justify-between overflow-hidden">
              {/* File Identity Strip */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="p-2 rounded-md bg-[#ffffff] dark:bg-[#191919] shadow-2xs">
                    {getFileIcon()}
                  </div>
                  <div className="min-w-0">
                    <h4
                      className="text-sm font-bold text-[#000000] dark:text-[#ffffff] truncate"
                      title={currentFile.filename}
                    >
                      {currentFile.filename}
                    </h4>
                    <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] truncate">
                      {currentFile.abs_path}
                    </p>
                  </div>
                </div>

                <span className="shrink-0 px-2 py-0.5 rounded text-[11px] font-medium bg-[#ffffff] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] text-[#615d59] dark:text-[#9b9a97]">
                  {formatBytes(currentFile.file_size_bytes)}
                </span>
              </div>

              {/* Visual Preview / OCR Monospace Excerpt */}
              <div className="my-2 rounded-lg bg-[#ffffff] dark:bg-[#181818] border border-[#e6e6e6] dark:border-[#2e2e2e] p-3 flex-1 flex flex-col justify-center min-h-[220px] max-h-[340px] overflow-hidden relative">
                {currentFile.thumbnail_b64 ? (
                  <div className="h-full w-full flex items-center justify-center overflow-hidden">
                    <img
                      src={`data:image/jpeg;base64,${currentFile.thumbnail_b64}`}
                      alt={currentFile.filename}
                      className="max-h-[280px] max-w-full object-contain rounded-md shadow-xs"
                    />
                  </div>
                ) : currentFile.extracted_text ? (
                  <div className="h-full flex flex-col justify-between space-y-2">
                    <div className="flex items-center justify-between text-[11px] text-[#615d59] dark:text-[#9b9a97] border-b border-[#f0eee9] dark:border-[#282828] pb-1.5">
                      <span className="flex items-center gap-1 font-semibold">
                        <FileText className="w-3 h-3 text-[#0075de]" /> Extracted OCR Text Excerpt:
                      </span>
                      <button
                        onClick={() => setShowFullText(!showFullText)}
                        className="text-[11px] text-[#0075de] dark:text-[#2383e2] hover:underline cursor-pointer"
                      >
                        {showFullText ? "Collapse" : "Expand Full"}
                      </button>
                    </div>
                    <pre
                      className={`text-[12px] font-mono text-[#333333] dark:text-[#d1d1d1] whitespace-pre-wrap break-words overflow-y-auto leading-relaxed ${
                        showFullText ? "max-h-[260px]" : "max-h-[190px]"
                      }`}
                    >
                      {currentFile.extracted_text}
                    </pre>
                  </div>
                ) : (
                  <div className="text-center py-8 space-y-2 text-[#615d59] dark:text-[#9b9a97]">
                    <div className="w-12 h-12 rounded-full bg-[#f6f5f4] dark:bg-[#252525] flex items-center justify-center mx-auto text-xl">
                      📄
                    </div>
                    <p className="text-[12px] font-medium">No direct text/thumbnail preview available</p>
                    <p className="text-[11px] max-w-xs mx-auto">
                      Format: {currentFile.extension.toUpperCase()} • Type: {currentFile.file_category}
                    </p>
                  </div>
                )}
              </div>

              {/* Reason / Context */}
              <div className="text-[11px] text-[#615d59] dark:text-[#9b9a97] bg-[#ffffff] dark:bg-[#181818] p-2.5 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e] flex items-center justify-between gap-2">
                <span>
                  <strong className="text-[#000000] dark:text-[#ffffff]">AI Reason:</strong>{" "}
                  {currentFile.reason || "Uncertain context / Low confidence"}
                </span>
                {currentAssignedCat && (
                  <span className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-[#166534] dark:text-[#4ade80] bg-[#dcfce7] dark:bg-[#052e16] px-2 py-0.5 rounded">
                    <Check className="w-3 h-3" /> Triaged to: {currentAssignedCat}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Right: Quick Action Controls (5 Cols) */}
          <div className="lg:col-span-5 flex flex-col justify-between space-y-5">
            <div className="space-y-4">
              <div>
                <h4 className="text-xs font-bold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97] mb-2">
                  1. Assign to Existing Category
                </h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {localCategories.map((cat, idx) => {
                    const isNumShortcut = idx < 9;
                    const isSelected = currentAssignedCat === cat;

                    return (
                      <button
                        key={cat}
                        onClick={() => handleAssign(cat)}
                        className={`p-2.5 rounded-xl text-left border flex items-center justify-between transition group cursor-pointer active:scale-98 ${
                          isSelected
                            ? "bg-[#0075de] text-white border-[#0075de] shadow-sm"
                            : "bg-[#ffffff] dark:bg-[#202020] hover:bg-[#f6f5f4] dark:hover:bg-[#282828] border-[#e6e6e6] dark:border-[#2e2e2e] text-[#000000] dark:text-[#ffffff]"
                        }`}
                      >
                        <span className="text-[12px] font-medium truncate" title={cat}>
                          {cat}
                        </span>
                        {isNumShortcut && (
                          <span
                            className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              isSelected
                                ? "bg-white/20 text-white"
                                : "bg-[#f0eee9] dark:bg-[#303030] text-[#615d59] dark:text-[#9b9a97] group-hover:bg-[#0075de]/10 group-hover:text-[#0075de]"
                            }`}
                          >
                            {idx + 1}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* 2. Custom Folder Input */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97] mb-2">
                  2. Or Create New Destination Folder
                </h4>
                <form onSubmit={handleCustomFolderSubmit} className="flex gap-2">
                  <div className="relative flex-1">
                    <FolderPlus className="w-3.5 h-3.5 text-[#615d59] absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={customFolder}
                      onChange={(e) => setCustomFolder(e.target.value)}
                      placeholder="e.g. React_Course, Wallpapers..."
                      className="w-full bg-[#f6f5f4] dark:bg-[#202020] border border-[#e6e6e6] dark:border-[#333333] rounded-lg pl-8 pr-3 py-2 text-[12px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2]"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={!customFolder.trim()}
                    className="px-3.5 py-2 bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] text-white text-[12px] font-semibold rounded-lg shadow-2xs disabled:opacity-40 cursor-pointer transition"
                  >
                    Assign
                  </button>
                </form>
              </div>

              {/* 3. Quick Utility Actions */}
              <div className="pt-2 border-t border-[#f0eee9] dark:border-[#282828] space-y-2">
                <button
                  onClick={() => handleAssign("_Unsorted_Archive")}
                  className="w-full py-2 px-3 rounded-lg border border-dashed border-[#e6e6e6] dark:border-[#333333] hover:border-[#0075de] text-[12px] font-medium text-[#615d59] dark:text-[#9b9a97] hover:text-[#0075de] dark:hover:text-[#2383e2] flex items-center justify-center gap-2 cursor-pointer transition"
                >
                  <Archive className="w-3.5 h-3.5" />
                  <span>Move to _Unsorted_Archive</span>
                </button>

                <button
                  onClick={handleSkip}
                  className="w-full py-2 px-3 rounded-lg bg-[#f6f5f4] dark:bg-[#222222] hover:bg-[#eae8e5] dark:hover:bg-[#2a2a2a] text-[12px] font-medium text-[#615d59] dark:text-[#9b9a97] flex items-center justify-center gap-2 cursor-pointer transition"
                >
                  <SkipForward className="w-3.5 h-3.5" />
                  <span>Skip / Leave in Place (Space)</span>
                </button>
              </div>
            </div>

            {/* Bottom Nav Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-[#e6e6e6] dark:border-[#2e2e2e]">
              <button
                onClick={handlePrev}
                disabled={currentIndex === 0}
                className="px-3.5 py-2 rounded-xl border border-[#e6e6e6] dark:border-[#383838] bg-[#ffffff] dark:bg-[#252525] hover:bg-[#f6f5f4] dark:hover:bg-[#2e2e2e] text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] disabled:opacity-30 cursor-pointer flex items-center gap-1.5 shadow-2xs transition"
              >
                <ChevronLeft className="w-4 h-4" /> Previous
              </button>

              <button
                onClick={onClose}
                className="px-5 py-2 bg-[#1d1d1f] hover:bg-[#000000] dark:bg-[#ffffff] dark:hover:bg-[#f0f0f0] text-white dark:text-[#000000] text-[12px] font-semibold rounded-xl shadow-2xs cursor-pointer transition"
              >
                Finish Triage ({queue.length - currentIndex} remaining)
              </button>

              <button
                onClick={handleSkip}
                disabled={currentIndex >= queue.length - 1}
                className="px-3.5 py-2 rounded-xl border border-[#e6e6e6] dark:border-[#383838] bg-[#ffffff] dark:bg-[#252525] hover:bg-[#f6f5f4] dark:hover:bg-[#2e2e2e] text-[12px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] disabled:opacity-30 cursor-pointer flex items-center gap-1.5 shadow-2xs transition"
              >
                Next <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
