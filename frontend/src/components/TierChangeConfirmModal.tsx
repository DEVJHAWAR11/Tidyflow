import React, { useState } from "react";
import { createPortal } from "react-dom";
import { CategoryItem, ComplexityLevel } from "../types";
import {
  Grid2X2,
  LayoutGrid,
  Layers,
  ArrowRight,
  Sparkles,
  History,
  X,
  Check,
  PlusCircle,
  MinusCircle,
  FolderTree,
  Folder,
  Loader2,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface TierChangeConfirmModalProps {
  isOpen: boolean;
  currentTier: ComplexityLevel;
  targetTier: ComplexityLevel;
  currentCategories: Record<string, CategoryItem>;
  proposedCategories?: Record<string, CategoryItem>;
  isLoadingProposal?: boolean;
  fileCount?: number;
  onClose: () => void;
  onConfirm: () => void;
  context?: "blueprint" | "review";
}

const TIER_META = {
  low: {
    label: "Simple",
    icon: Grid2X2,
    structure: "Flat Structure",
    color: "#0075de",
    description: "Flat top-level categories without subfolders for rapid, minimal decluttering.",
  },
  medium: {
    label: "Balanced",
    icon: LayoutGrid,
    structure: "Subfolders",
    color: "#166534",
    description: "Functional organization with clean 1-level subfolders for common workflows.",
  },
  high: {
    label: "Detailed",
    icon: Layers,
    structure: "Deep Tree",
    color: "#854d0e",
    description: "Deep multi-level hierarchy tailored by topic, project, date, and file format.",
  },
};

export const TierChangeConfirmModal: React.FC<TierChangeConfirmModalProps> = ({
  isOpen,
  currentTier,
  targetTier,
  currentCategories = {},
  proposedCategories = {},
  isLoadingProposal = false,
  fileCount = 0,
  onClose,
  onConfirm,
  context = "review",
}) => {
  const [showAllProposed, setShowAllProposed] = useState(false);

  if (!isOpen || currentTier === targetTier) return null;

  const fromMeta = TIER_META[currentTier] || TIER_META.medium;
  const toMeta = TIER_META[targetTier] || TIER_META.high;
  const FromIcon = fromMeta.icon;
  const ToIcon = toMeta.icon;

  const currentKeys = Object.keys(currentCategories);
  const proposedKeys = Object.keys(proposedCategories);

  // Compute what changed
  const addedKeys = proposedKeys.filter((k) => !currentCategories[k]);
  const removedKeys = currentKeys.filter((k) => !proposedCategories[k]);
  const retainedKeys = proposedKeys.filter((k) => currentCategories[k]);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 md:p-6 bg-black/50 dark:bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#ffffff] dark:bg-[#1c1c1e] rounded-2xl border border-[#e5e5e7] dark:border-[#2c2c2e] shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col overflow-hidden animate-scale-in">
        {/* Modal Header */}
        <div className="p-5 border-b border-[#e5e5e7] dark:border-[#2c2c2e] flex items-start justify-between gap-3 bg-[#fafafc] dark:bg-[#222224]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8] flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
                Review Proposed Category Changes
              </h3>
              <p className="text-[12px] text-[#86868b]">
                {context === "review"
                  ? fileCount > 0
                    ? `Compare how categories and ${fileCount} review files will change`
                    : "Compare how categories and review files will change"
                  : "Inspect folder modifications before updating your blueprint"}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:bg-[#f2f2f7] dark:hover:bg-[#2c2c2e] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Tier Transition Bar */}
          <div className="p-3.5 rounded-xl bg-[#f2f2f7]/70 dark:bg-[#242426] border border-[#e5e5e7] dark:border-[#2c2c2e]">
            <div className="grid grid-cols-2 gap-3 items-center relative">
              {/* From Tier */}
              <div className="p-3 rounded-lg bg-[#ffffff] dark:bg-[#1c1c1e] border border-[#e5e5e7] dark:border-[#2c2c2e] space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#86868b]">
                  Current ({currentKeys.length} folders)
                </span>
                <div className="flex items-center gap-1.5">
                  <FromIcon className="w-4 h-4 text-[#86868b]" />
                  <span className="text-[13px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
                    {fromMeta.label}
                  </span>
                </div>
                <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-[#f2f2f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#98989d] inline-block">
                  {fromMeta.structure}
                </span>
              </div>

              {/* Transition Arrow */}
              <div className="absolute left-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-[#0075de] text-white flex items-center justify-center shadow-xs z-10">
                <ArrowRight className="w-3.5 h-3.5" />
              </div>

              {/* To Tier */}
              <div className="p-3 rounded-lg bg-[#0075de]/5 dark:bg-[#0075de]/15 border border-[#0075de]/40 dark:border-[#0075de]/50 space-y-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-[#0075de] dark:text-[#38bdf8]">
                  Proposed ({proposedKeys.length} folders)
                </span>
                <div className="flex items-center gap-1.5">
                  <ToIcon className="w-4 h-4 text-[#0075de] dark:text-[#38bdf8]" />
                  <span className="text-[13px] font-bold text-[#0075de] dark:text-[#38bdf8]">
                    {toMeta.label}
                  </span>
                </div>
                <span className="text-[10.5px] font-mono px-1.5 py-0.5 rounded bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8] inline-block font-semibold">
                  {toMeta.structure}
                </span>
              </div>
            </div>
          </div>

          {/* Loading State or Category Diff */}
          {isLoadingProposal ? (
            <div className="p-8 rounded-xl border border-dashed border-[#0075de]/40 bg-[#0075de]/5 flex flex-col items-center justify-center text-center space-y-2.5">
              <Loader2 className="w-6 h-6 animate-spin text-[#0075de] dark:text-[#38bdf8]" />
              <span className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">
                AI is generating the new category structure for {toMeta.label} tier...
              </span>
              <p className="text-[11.5px] text-[#86868b] max-w-sm">
                Inspecting file formats and analyzing document contexts.
              </p>
            </div>
          ) : (
            <div className="space-y-3.5">
              {/* Added Categories Section */}
              {addedKeys.length > 0 && (
                <div className="p-3.5 rounded-xl bg-emerald-500/5 dark:bg-emerald-500/10 border border-emerald-500/30 space-y-2">
                  <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
                    <span className="text-[12px] font-bold flex items-center gap-1.5">
                      <PlusCircle className="w-4 h-4" />
                      <span>New Folders Created ({addedKeys.length})</span>
                    </span>
                    <span className="text-[10.5px] font-mono font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15">
                      + Added
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                    {addedKeys.map((name) => {
                      const item = proposedCategories[name];
                      return (
                        <div
                          key={name}
                          className="p-2.5 rounded-lg bg-[#ffffff] dark:bg-[#1c1c1e] border border-emerald-500/20 shadow-2xs space-y-1"
                        >
                          <div className="flex items-center gap-1.5 font-bold text-[12.5px] text-emerald-800 dark:text-emerald-300">
                            <Folder className="w-3.5 h-3.5 shrink-0" />
                            <span className="truncate" title={name}>
                              {name}
                            </span>
                          </div>
                          {item?.description && (
                            <p className="text-[11px] text-[#6e6e73] dark:text-[#98989d] line-clamp-1">
                              {item.description}
                            </p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Removed / Consolidated Categories Section */}
              {removedKeys.length > 0 && (
                <div className="p-3.5 rounded-xl bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/30 space-y-2">
                  <div className="flex items-center justify-between text-rose-700 dark:text-rose-400">
                    <span className="text-[12px] font-bold flex items-center gap-1.5">
                      <MinusCircle className="w-4 h-4" />
                      <span>Consolidated / Removed Folders ({removedKeys.length})</span>
                    </span>
                    <span className="text-[10.5px] font-mono font-semibold px-2 py-0.5 rounded-full bg-rose-500/15">
                      - Replaced
                    </span>
                  </div>

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {removedKeys.map((name) => (
                      <span
                        key={name}
                        className="px-2.5 py-1 rounded-md text-[11.5px] font-mono bg-[#ffffff] dark:bg-[#1c1c1e] text-rose-700 dark:text-rose-400 border border-rose-500/20 line-through opacity-80"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Retained / Unchanged Categories */}
              {retainedKeys.length > 0 && (
                <div className="p-3 rounded-xl bg-[#f2f2f7]/60 dark:bg-[#252528] border border-[#e5e5e7] dark:border-[#2c2c2e] space-y-1.5">
                  <span className="text-[11.5px] font-semibold text-[#6e6e73] dark:text-[#98989d]">
                    Retained Folders ({retainedKeys.length})
                  </span>
                  <div className="flex flex-wrap gap-1.5">
                    {retainedKeys.map((name) => (
                      <span
                        key={name}
                        className="px-2 py-0.5 rounded text-[11px] font-mono bg-[#ffffff] dark:bg-[#1c1c1e] text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#e5e5e7] dark:border-[#2c2c2e]"
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Complete Proposed Taxonomy Preview Dropdown */}
              {proposedKeys.length > 0 && (
                <div className="pt-1">
                  <button
                    onClick={() => setShowAllProposed(!showAllProposed)}
                    className="w-full py-2 px-3 rounded-xl border border-[#e5e5e7] dark:border-[#2c2c2e] hover:bg-[#f2f2f7] dark:hover:bg-[#252528] text-[12px] font-semibold text-[#6e6e73] dark:text-[#98989d] flex items-center justify-between transition cursor-pointer"
                  >
                    <div className="flex items-center gap-2">
                      <FolderTree className="w-3.5 h-3.5 text-[#0075de]" />
                      <span>Full Proposed Structure ({proposedKeys.length} folders)</span>
                    </div>
                    {showAllProposed ? (
                      <ChevronUp className="w-4 h-4" />
                    ) : (
                      <ChevronDown className="w-4 h-4" />
                    )}
                  </button>

                  {showAllProposed && (
                    <div className="mt-2 p-3.5 rounded-xl bg-[#fafafc] dark:bg-[#202022] border border-[#e5e5e7] dark:border-[#2c2c2e] grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto animate-fade-in">
                      {Object.entries(proposedCategories).map(([name, cat]) => (
                        <div
                          key={name}
                          className="p-2 rounded-lg bg-[#ffffff] dark:bg-[#1c1c1e] border border-[#e5e5e7] dark:border-[#2c2c2e] text-[11.5px]"
                        >
                          <span className="font-bold text-[#1d1d1f] dark:text-[#f5f5f7] truncate block">
                            📁 {name}
                          </span>
                          {cat.description && (
                            <span className="text-[10.5px] text-[#86868b] line-clamp-1">
                              {cat.description}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Backup Guarantee Notice */}
              <div className="p-2.5 rounded-lg bg-[#0075de]/5 dark:bg-[#0075de]/10 border border-[#0075de]/20 flex items-center gap-2 text-[11.5px] text-[#0075de] dark:text-[#38bdf8]">
                <History className="w-4 h-4 shrink-0" />
                <span>
                  Your current {currentKeys.length} categories will be automatically archived to Version History for instant 1-click rollback.
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Modal Actions */}
        <div className="p-4 border-t border-[#e5e5e7] dark:border-[#2c2c2e] bg-[#fafafc] dark:bg-[#222224] flex items-center justify-end gap-2.5">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-[13px] font-medium text-[#6e6e73] dark:text-[#98989d] hover:bg-[#f2f2f7] dark:hover:bg-[#2c2c2e] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            disabled={isLoadingProposal || proposedKeys.length === 0}
            className="px-5 py-2 rounded-xl bg-[#0075de] hover:bg-[#0062bd] dark:bg-[#2383e2] dark:hover:bg-[#1a73cb] disabled:opacity-50 disabled:cursor-not-allowed text-white text-[13px] font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer active:scale-[0.98]"
          >
            <Check className="w-3.5 h-3.5" />
            <span>Agree & Apply Changes</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
};
