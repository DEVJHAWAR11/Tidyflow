import React, { useState } from "react";
import { createPortal } from "react-dom";
import { CategoryItem, CategorySnapshot } from "../types";
import { formatSnapshotRelativeTime } from "../utils/categoryHistory";
import {
  History,
  RotateCcw,
  X,
  Trash2,
  FolderTree,
  Folder,
  Sparkles,
  Layers,
  LayoutGrid,
  CheckCircle2,
} from "lucide-react";

interface CategoryHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  snapshots: CategorySnapshot[];
  currentCategories: Record<string, CategoryItem>;
  onRestoreSnapshot: (snapshot: CategorySnapshot) => void;
  onDeleteSnapshot: (id: string) => void;
  onClearHistory: () => void;
}

const TRIGGER_BADGES: Record<
  CategorySnapshot["trigger"],
  { label: string; bg: string; text: string; icon: React.FC<{ className?: string }> }
> = {
  tier_switch: {
    label: "Tier Switch",
    bg: "bg-[#0075de]/10 dark:bg-[#0075de]/20",
    text: "text-[#0075de] dark:text-[#38bdf8]",
    icon: Layers,
  },
  ai_synthesis: {
    label: "AI Synthesis",
    bg: "bg-[#7c3aed]/10 dark:bg-[#7c3aed]/20",
    text: "text-[#7c3aed] dark:text-[#c084fc]",
    icon: Sparkles,
  },
  preset: {
    label: "Preset Pack",
    bg: "bg-[#166534]/10 dark:bg-[#166534]/20",
    text: "text-[#166534] dark:text-[#4ade80]",
    icon: LayoutGrid,
  },
  manual_edit: {
    label: "Manual Triage",
    bg: "bg-[#c2410c]/10 dark:bg-[#c2410c]/20",
    text: "text-[#c2410c] dark:text-[#fb923c]",
    icon: Folder,
  },
  ai_edit: {
    label: "AI Edit",
    bg: "bg-[#0891b2]/10 dark:bg-[#0891b2]/20",
    text: "text-[#0891b2] dark:text-[#22d3ee]",
    icon: Sparkles,
  },
  restore: {
    label: "Restored",
    bg: "bg-[#4b5563]/10 dark:bg-[#4b5563]/20",
    text: "text-[#4b5563] dark:text-[#9ca3af]",
    icon: RotateCcw,
  },
  init: {
    label: "Initial",
    bg: "bg-[#6b7280]/10 dark:bg-[#6b7280]/20",
    text: "text-[#6b7280] dark:text-[#d1d5db]",
    icon: FolderTree,
  },
};

export const CategoryHistoryModal: React.FC<CategoryHistoryModalProps> = ({
  isOpen,
  onClose,
  snapshots,
  currentCategories,
  onRestoreSnapshot,
  onDeleteSnapshot,
  onClearHistory,
}) => {
  const [selectedSnapshotId, setSelectedSnapshotId] = useState<string | null>(() => {
    return snapshots.length > 0 ? snapshots[0].id : null;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  if (!isOpen) return null;

  const filteredSnapshots = snapshots.filter((s) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      s.label.toLowerCase().includes(q) ||
      s.trigger.toLowerCase().includes(q) ||
      (s.complexity_level || "").toLowerCase().includes(q) ||
      s.folderNames.some((f) => f.toLowerCase().includes(q))
    );
  });

  const selectedSnapshot =
    snapshots.find((s) => s.id === selectedSnapshotId) || filteredSnapshots[0] || null;

  const isCurrentActive =
    selectedSnapshot &&
    Object.keys(currentCategories).length === selectedSnapshot.folderNames.length &&
    selectedSnapshot.folderNames.every((f) => currentCategories[f] !== undefined);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 md:p-6 bg-black/50 dark:bg-black/70 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#ffffff] dark:bg-[#1c1c1e] rounded-2xl border border-[#e5e5e7] dark:border-[#2c2c2e] shadow-2xl max-w-5xl w-full h-[85vh] flex flex-col overflow-hidden animate-scale-in">
        {/* Modal Header */}
        <div className="px-6 py-4 border-b border-[#e5e5e7] dark:border-[#2c2c2e] flex items-center justify-between gap-4 bg-[#fafafc] dark:bg-[#242426]">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8] flex items-center justify-center shrink-0">
              <History className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
                  Category Version History
                </h3>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#e5e5ea] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#98989d]">
                  {snapshots.length} {snapshots.length === 1 ? "snapshot" : "snapshots"}
                </span>
              </div>
              <p className="text-[12px] text-[#86868b]">
                Browse previous category architectures, inspect folder definitions, and restore with 1 click.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {snapshots.length > 0 && !showClearConfirm && (
              <button
                onClick={() => setShowClearConfirm(true)}
                className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#86868b] hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 transition cursor-pointer flex items-center gap-1"
                title="Clear all saved category snapshots"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear History</span>
              </button>
            )}

            {showClearConfirm && (
              <div className="flex items-center gap-1.5 bg-[#ff3b30]/10 p-1 rounded-lg">
                <span className="text-[11px] text-[#ff3b30] font-semibold px-1">Clear all?</span>
                <button
                  onClick={() => {
                    onClearHistory();
                    setShowClearConfirm(false);
                  }}
                  className="px-2 py-0.5 rounded bg-[#ff3b30] text-white text-[11px] font-bold cursor-pointer"
                >
                  Yes
                </button>
                <button
                  onClick={() => setShowClearConfirm(false)}
                  className="px-2 py-0.5 rounded text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] text-[11px] cursor-pointer"
                >
                  No
                </button>
              </div>
            )}

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:bg-[#f2f2f7] dark:hover:bg-[#2c2c2e] transition cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Split View */}
        {snapshots.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
            <div className="w-12 h-12 rounded-2xl bg-[#f2f2f7] dark:bg-[#2c2c2e] text-[#86868b] flex items-center justify-center">
              <History className="w-6 h-6" />
            </div>
            <h4 className="text-[15px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
              No Category Snapshots Yet
            </h4>
            <p className="text-[13px] text-[#86868b] max-w-sm">
              As you generate taxonomies, switch tiers, or load presets, automatic timestamped snapshots will be saved here.
            </p>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Left Column: Timeline List */}
            <div className="w-80 md:w-96 border-r border-[#e5e5e7] dark:border-[#2c2c2e] flex flex-col bg-[#ffffff] dark:bg-[#1c1c1e]">
              <div className="p-3 border-b border-[#e5e5e7] dark:border-[#2c2c2e]">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Filter versions or folder names..."
                  className="w-full bg-[#f2f2f7] dark:bg-[#242426] border border-[#e5e5e7] dark:border-[#2c2c2e] rounded-lg px-3 py-1.5 text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none focus:border-[#0075de]"
                />
              </div>

              <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
                {filteredSnapshots.map((snap) => {
                  const isSelected = selectedSnapshot?.id === snap.id;
                  const badge = TRIGGER_BADGES[snap.trigger] || TRIGGER_BADGES.ai_synthesis;
                  const BadgeIcon = badge.icon;
                  const isCurrentlyActive =
                    Object.keys(currentCategories).length === snap.folderNames.length &&
                    snap.folderNames.every((f) => currentCategories[f] !== undefined);

                  return (
                    <div
                      key={snap.id}
                      onClick={() => setSelectedSnapshotId(snap.id)}
                      className={`p-3 rounded-xl border transition-all cursor-pointer flex flex-col gap-2 group relative ${
                        isSelected
                          ? "bg-[#0075de]/5 dark:bg-[#0075de]/15 border-[#0075de] dark:border-[#38bdf8] shadow-xs"
                          : "bg-[#ffffff] dark:bg-[#242426] border-[#e5e5e7] dark:border-[#2c2c2e] hover:border-[#0075de]/50"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex items-center gap-1 ${badge.bg} ${badge.text}`}
                        >
                          <BadgeIcon className="w-3 h-3" />
                          <span>{badge.label}</span>
                        </span>

                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-[#86868b]">
                            {formatSnapshotRelativeTime(snap.timestamp)}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onDeleteSnapshot(snap.id);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 text-[#86868b] hover:text-[#ff3b30] rounded transition cursor-pointer"
                            title="Delete this snapshot"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <div>
                        <h4 className="text-[13px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                          {snap.label}
                        </h4>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-[#86868b]">
                          <span>{snap.categoryCount} folders</span>
                          {snap.complexity_level && (
                            <>
                              <span>•</span>
                              <span className="capitalize">{snap.complexity_level}</span>
                            </>
                          )}
                          {isCurrentlyActive && (
                            <span className="text-[10px] font-semibold text-[#166534] dark:text-[#4ade80] bg-[#dcfce7] dark:bg-[#052e16] px-1.5 py-0.2 rounded-full">
                              Active
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Right Column: Interactive Preview Pane */}
            <div className="flex-1 flex flex-col bg-[#fafafc] dark:bg-[#202022] overflow-hidden">
              {selectedSnapshot ? (
                <>
                  {/* Selected Snapshot Header Bar */}
                  <div className="p-4 border-b border-[#e5e5e7] dark:border-[#2c2c2e] bg-[#ffffff] dark:bg-[#1c1c1e] flex flex-wrap items-center justify-between gap-3 shadow-2xs">
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-[15px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
                          {selectedSnapshot.label}
                        </h4>
                        {isCurrentActive && (
                          <span className="text-[11px] font-semibold text-[#166534] dark:text-[#4ade80] bg-[#dcfce7] dark:bg-[#052e16] px-2 py-0.5 rounded-full flex items-center gap-1">
                            <CheckCircle2 className="w-3 h-3" />
                            <span>Currently Active</span>
                          </span>
                        )}
                      </div>
                      <p className="text-[12px] text-[#86868b] mt-0.5">
                        Recorded on {new Date(selectedSnapshot.timestamp).toLocaleString()} •{" "}
                        {selectedSnapshot.categoryCount} destination categories
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        onRestoreSnapshot(selectedSnapshot);
                        onClose();
                      }}
                      className="px-4 py-2 rounded-xl bg-[#0075de] hover:bg-[#0062bd] dark:bg-[#2383e2] dark:hover:bg-[#1a73cb] text-white text-[12.5px] font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer active:scale-[0.98]"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Restore this Version</span>
                    </button>
                  </div>

                  {/* Categories Grid Preview */}
                  <div className="flex-1 overflow-y-auto p-5">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                      {Object.entries(selectedSnapshot.categories).map(([name, cat]) => {
                        const isNested = name.includes("/");
                        return (
                          <div
                            key={name}
                            className="p-3.5 rounded-xl bg-[#ffffff] dark:bg-[#1c1c1e] border border-[#e5e5e7] dark:border-[#2c2c2e] space-y-2 shadow-2xs"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 truncate">
                                <div className="p-1.5 rounded-lg bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8] shrink-0">
                                  <Folder className="w-3.5 h-3.5" />
                                </div>
                                <span
                                  className="text-[13px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7] truncate"
                                  title={name}
                                >
                                  {name}
                                </span>
                              </div>
                              {isNested && (
                                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#f2f2f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#98989d]">
                                  Subfolder
                                </span>
                              )}
                            </div>

                            {cat.description && (
                              <p className="text-[11.5px] text-[#6e6e73] dark:text-[#98989d] line-clamp-2 leading-relaxed">
                                {cat.description}
                              </p>
                            )}

                            {cat.keywords && cat.keywords.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-1">
                                {cat.keywords.slice(0, 5).map((kw) => (
                                  <span
                                    key={kw}
                                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#f2f2f7] dark:bg-[#242426] text-[#6e6e73] dark:text-[#98989d]"
                                  >
                                    #{kw}
                                  </span>
                                ))}
                                {cat.keywords.length > 5 && (
                                  <span className="text-[10px] text-[#86868b] self-center font-mono">
                                    +{cat.keywords.length - 5}
                                  </span>
                                )}
                              </div>
                            )}

                            {cat.extensions && cat.extensions.length > 0 && (
                              <div className="flex flex-wrap gap-1 pt-0.5">
                                {cat.extensions.map((ext) => (
                                  <span
                                    key={ext}
                                    className="text-[10px] font-mono font-semibold px-1.5 py-0.2 rounded bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8]"
                                  >
                                    {ext}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center text-[#86868b] text-[13px]">
                  Select a version from the timeline to preview
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
