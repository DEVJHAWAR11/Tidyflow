import React, { useState, useMemo, useEffect } from "react";
import { createPortal } from "react-dom";
import { ClassifiedFile, RunSummary, CategoryItem, ComplexityLevel, CategorySnapshot } from "../types";
import { API_BASE } from "../config";
import { getStickerStyle, formatBytes } from "../utils/stickerTheme";
import {
  loadCategorySnapshots,
  saveCategorySnapshot,
  deleteCategorySnapshot,
  clearCategoryHistory,
} from "../utils/categoryHistory";
import { QuickTriageModal } from "./QuickTriageModal";
import { WorkflowStepper } from "./WorkflowStepper";
import { ApplySuccessModal } from "./ApplySuccessModal";
import { TierChangeConfirmModal } from "./TierChangeConfirmModal";
import { CategoryHistoryModal } from "./CategoryHistoryModal";
import {
  Search,
  CheckCircle2,
  FileText,
  Eye,
  X,
  Sparkles,
  Send,
  Loader2,
  FolderCheck,
  FolderOpen,
  Edit2,
  Check,
  RotateCcw,
  Grid2X2,
  LayoutGrid,
  Layers,
  Plus,
  History,
} from "lucide-react";

interface ReviewViewProps {
  files: ClassifiedFile[];
  categories: Record<string, CategoryItem>;
  setCategories?: React.Dispatch<React.SetStateAction<Record<string, CategoryItem>>>;
  summary: RunSummary | null;
  selectedFileIds: Set<string>;
  setSelectedFileIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  categoryOverrides: Record<string, string>;
  setCategoryOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  filenameOverrides?: Record<string, string>;
  setFilenameOverrides?: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  autoThreshold: number;
  outputFolder: string;
  moveMode: boolean;
  setMoveMode: (val: boolean) => void;
  isApplying: boolean;
  applyResultModal: { count: number; action: string; output_dir: string } | null;
  setApplyResultModal: (val: { count: number; action: string; output_dir: string } | null) => void;
  onApplyDecisions: () => Promise<void>;
  onNavigateToOrganize: () => void;
  inputFolder?: string;
  onNavigateToSelectFolder?: () => void;
  onNavigateToSearch?: () => void;
  complexityLevel?: ComplexityLevel;
  setComplexityLevel?: (lvl: ComplexityLevel) => void;
  onReclassifyWithTier?: (tier: ComplexityLevel) => Promise<void>;
  isReclassifying?: boolean;
}

export const ReviewView: React.FC<ReviewViewProps> = ({
  files,
  categories,
  setCategories,
  selectedFileIds,
  setSelectedFileIds,
  categoryOverrides,
  setCategoryOverrides,
  filenameOverrides = {},
  setFilenameOverrides,
  autoThreshold,
  moveMode,
  setMoveMode,
  isApplying,
  applyResultModal,
  setApplyResultModal,
  onApplyDecisions,
  onNavigateToOrganize,
  inputFolder = "",
  onNavigateToSelectFolder,
  onNavigateToSearch,
  complexityLevel,
  setComplexityLevel,
  onReclassifyWithTier,
  isReclassifying = false,
}) => {
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterConfidence, setFilterConfidence] = useState<"all" | "high" | "review">("all");
  const [previewFile, setPreviewFile] = useState<ClassifiedFile | null>(null);
  const [aiCommand, setAiCommand] = useState("");
  const [isExecutingAi, setIsExecutingAi] = useState(false);
  const [aiFeedback, setAiFeedback] = useState<string | null>(null);
  const [isTriageOpen, setIsTriageOpen] = useState(false);
  const [isClustering, setIsClustering] = useState(false);
  const [clusterModalData, setClusterModalData] = useState<{
    message: string;
    clusters: Record<string, string[]>;
    category_overrides: Record<string, string>;
  } | null>(null);
  const [openedPath, setOpenedPath] = useState<string | null>(null);

  // History & Tier Confirmation state
  const [snapshots, setSnapshots] = useState<CategorySnapshot[]>(() => loadCategorySnapshots());
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isTierConfirmOpen, setIsTierConfirmOpen] = useState(false);
  const [pendingTier, setPendingTier] = useState<ComplexityLevel>("medium");
  const [proposedCategories, setProposedCategories] = useState<Record<string, CategoryItem>>({});
  const [isLoadingProposal, setIsLoadingProposal] = useState(false);

  // Keep snapshots fresh from storage
  useEffect(() => {
    setSnapshots(loadCategorySnapshots());
  }, [files, complexityLevel]);

  const handleTierSelect = async (tier: ComplexityLevel) => {
    if (tier === complexityLevel) return;
    setPendingTier(tier);
    setIsTierConfirmOpen(true);
    setIsLoadingProposal(true);
    setProposedCategories({});

    try {
      const payload = {
        message: `Analyze directory files and generate custom ${tier} category taxonomy`,
        history: [],
        input_dir: inputFolder || undefined,
        current_categories: undefined,
        complexity_level: tier,
        auto_discover: true,
      };
      const res = await fetch(`${API_BASE}/ai/chat-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.categories) {
          const parsedCats: Record<string, CategoryItem> = {};
          Object.entries(data.categories).forEach(([name, c]: [string, any]) => {
            parsedCats[name] = {
              name: c.name || name,
              description: c.description || "",
              keywords: c.keywords || [],
              extensions: c.extensions || [],
              active: c.active !== false,
            };
          });
          setProposedCategories(parsedCats);
        }
      }
    } catch (err) {
      console.warn("Failed to prefetch proposed categories for review:", err);
    } finally {
      setIsLoadingProposal(false);
    }
  };

  const handleConfirmTierChange = () => {
    if (setComplexityLevel) setComplexityLevel(pendingTier);
    if (Object.keys(proposedCategories).length > 0 && setCategories) {
      setCategories(proposedCategories);
      const updatedSnaps = saveCategorySnapshot(
        `${pendingTier.charAt(0).toUpperCase() + pendingTier.slice(1)} Tier Re-Classification`,
        "tier_switch",
        proposedCategories,
        pendingTier
      );
      setSnapshots(updatedSnaps);
      fetch(`${API_BASE}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: proposedCategories }),
      }).catch((e) => console.warn("Failed to persist categories:", e));
    }
    if (onReclassifyWithTier) {
      onReclassifyWithTier(pendingTier);
    }
    setIsTierConfirmOpen(false);
  };

  const handleRestoreSnapshot = (snap: CategorySnapshot) => {
    if (setCategories) {
      setCategories(snap.categories);
    }
    if (setComplexityLevel && snap.complexity_level) {
      setComplexityLevel(snap.complexity_level);
    }
    fetch(`${API_BASE}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories: snap.categories }),
    }).catch((e) => console.warn("Failed to persist restored snapshot:", e));

    if (onReclassifyWithTier) {
      onReclassifyWithTier(snap.complexity_level || "medium");
    }
  };

  const handleDeleteSnapshot = (id: string) => {
    const next = deleteCategorySnapshot(id);
    setSnapshots(next);
  };

  const handleClearHistory = () => {
    clearCategoryHistory();
    setSnapshots([]);
  };

  // Filename editing state
  const [editingFileId, setEditingFileId] = useState<string | null>(null);
  const [editingFileName, setEditingFileName] = useState<string>("");

  const handleStartEditFilename = (fileId: string, currentName: string) => {
    setEditingFileId(fileId);
    setEditingFileName(currentName);
  };

  const handleSaveFilename = (fileId: string) => {
    if (setFilenameOverrides && editingFileName.trim()) {
      setFilenameOverrides((prev) => ({
        ...prev,
        [fileId]: editingFileName.trim(),
      }));
    }
    setEditingFileId(null);
  };

  const handleApplySuggestedFilename = (fileId: string, suggestedName: string) => {
    if (setFilenameOverrides && suggestedName.trim()) {
      setFilenameOverrides((prev) => ({
        ...prev,
        [fileId]: suggestedName.trim(),
      }));
    }
  };

  const handleRevertFilename = (fileId: string) => {
    if (setFilenameOverrides) {
      setFilenameOverrides((prev) => {
        const next = { ...prev };
        delete next[fileId];
        return next;
      });
    }
  };

  const renameableFilesCount = useMemo(() => {
    return files.filter(
      (f) => f.suggested_filename && f.suggested_filename !== f.filename
    ).length;
  }, [files]);

  const overriddenFilenamesCount = useMemo(() => {
    return Object.keys(filenameOverrides).length;
  }, [filenameOverrides]);

  const handleApplyAllSuggestedFilenames = () => {
    if (!setFilenameOverrides) return;
    const updates: Record<string, string> = { ...filenameOverrides };
    files.forEach((f) => {
      if (f.suggested_filename && f.suggested_filename !== f.filename) {
        updates[f.file_id] = f.suggested_filename;
      }
    });
    setFilenameOverrides(updates);
  };

  const handleRevertAllFilenames = () => {
    if (setFilenameOverrides) {
      setFilenameOverrides({});
    }
  };

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

  // Unrecognized or low confidence files queue (only files that still need review/categorization)
  const unrecognizedFiles = useMemo(() => {
    return files.filter((f) => {
      const activeCat = categoryOverrides[f.file_id] || f.category;
      if (activeCat === "Unknown") return true;
      // If user or AI explicitly assigned a valid category (via clustering or dropdown), it is resolved
      if (categoryOverrides[f.file_id]) return false;
      return f.confidence < autoThreshold;
    });
  }, [files, categoryOverrides, autoThreshold]);

  const handleRunAiCluster = async () => {
    if (unrecognizedFiles.length === 0 || isClustering) return;
    setIsClustering(true);

    try {
      const res = await fetch(`${API_BASE}/ai/cluster-unrecognized`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          files: unrecognizedFiles.map((f) => ({
            file_id: f.file_id,
            filename: f.filename,
            extension: f.extension,
            file_category: f.file_category,
            extracted_text: f.extracted_text,
            reason: f.reason,
          })),
          existing_categories: Object.keys(categories),
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to auto-cluster files");
      }

      const data = await res.json();
      setClusterModalData(data);
    } catch (err: any) {
      alert(`Auto-clustering error: ${err.message}`);
    } finally {
      setIsClustering(false);
    }
  };

  const handleApplyClusters = () => {
    if (!clusterModalData) return;
    const overrides = clusterModalData.category_overrides || {};
    const clusters = clusterModalData.clusters || {};

    setCategoryOverrides((prev) => ({
      ...prev,
      ...overrides,
    }));

    // Add discovered cluster categories to global category map and sync with backend
    if (setCategories && Object.keys(clusters).length > 0) {
      setCategories((prev) => {
        const updated = { ...prev };
        let hasChanges = false;
        Object.keys(clusters).forEach((catName) => {
          if (!updated[catName]) {
            updated[catName] = {
              name: catName,
              description: `AI cluster discovered for ${clusters[catName].length} files`,
              keywords: [],
              extensions: [],
              active: true,
            };
            hasChanges = true;
          }
        });
        if (hasChanges) {
          fetch(`${API_BASE}/categories`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ categories: updated }),
          }).catch((e) => console.warn("Failed to sync new cluster categories:", e));
        }
        return updated;
      });
    }

    // Auto-select clustered files
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      Object.keys(overrides).forEach((fid) => next.add(fid));
      return next;
    });

    setAiFeedback(
      `✓ Applied ${Object.keys(clusters).length} cluster categories to ${
        Object.keys(overrides).length
      } files!`
    );
    setClusterModalData(null);
  };

  const handleAssignInTriage = (fileId: string, category: string, autoSelect = true) => {
    setCategoryOverrides((prev) => ({ ...prev, [fileId]: category }));
    if (autoSelect) {
      setSelectedFileIds((prev) => {
        const next = new Set(prev);
        next.add(fileId);
        return next;
      });
    }

    // If custom category was entered, register it globally and persist
    if (setCategories && category && category !== "_Unsorted_Archive") {
      setCategories((prev) => {
        if (prev[category]) return prev;
        const updated = {
          ...prev,
          [category]: {
            name: category,
            description: "Custom user-assigned triage category",
            keywords: [category.toLowerCase()],
            extensions: [],
            active: true,
          },
        };
        fetch(`${API_BASE}/categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories: updated }),
        }).catch((e) => console.warn("Failed to sync new triage category:", e));
        return updated;
      });
    }
  };

  const handleRunAiEdit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cmd = aiCommand.trim();
    if (!cmd || isExecutingAi) return;

    setIsExecutingAi(true);
    setAiFeedback(null);

    try {
      const res = await fetch(`${API_BASE}/ai/review-chat`, {
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
        setSelectedFileIds((prev) => {
          const next = new Set(prev);
          Object.keys(data.category_overrides).forEach((fid) => next.add(fid));
          return next;
        });
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
      const isResolved = Boolean(categoryOverrides[f.file_id] && categoryOverrides[f.file_id] !== "Unknown");
      const effectiveConf = isResolved ? 1.0 : f.confidence;

      if (filterCategory !== "all" && activeCat !== filterCategory) return false;
      if (filterConfidence === "high" && (effectiveConf < autoThreshold || activeCat === "Unknown")) return false;
      if (filterConfidence === "review" && (effectiveConf >= autoThreshold && activeCat !== "Unknown")) return false;

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

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    files.forEach((f) => {
      const cat = categoryOverrides[f.file_id] || f.category || "Unknown";
      counts[cat] = (counts[cat] || 0) + 1;
    });
    return counts;
  }, [files, categoryOverrides]);

  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const handleCreateCategory = (e: React.FormEvent) => {
    e.preventDefault();
    const cat = newCatName.trim().replace(/^[\/\\]+|[\/\\]+$/g, "");
    if (!cat) return;

    if (setCategories) {
      setCategories((prev) => {
        if (prev[cat]) return prev;
        const updated = {
          ...prev,
          [cat]: {
            name: cat,
            description: "Custom user category",
            keywords: [cat.toLowerCase()],
            extensions: [],
            active: true,
          },
        };
        fetch(`${API_BASE}/categories`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ categories: updated }),
        }).catch((err) => console.warn("Failed to sync category:", err));
        return updated;
      });
    }

    if (selectedFileIds.size > 0) {
      setCategoryOverrides((prev) => {
        const next = { ...prev };
        selectedFileIds.forEach((id) => {
          next[id] = cat;
        });
        return next;
      });
    }

    setFilterCategory(cat);
    setNewCatName("");
    setIsAddingCategory(false);
  };

  const highConfidenceCount = useMemo(() => {
    return files.filter((f) => {
      const activeCat = categoryOverrides[f.file_id] || f.category;
      if (activeCat === "Unknown") return false;
      if (categoryOverrides[f.file_id]) return true;
      return f.confidence >= autoThreshold;
    }).length;
  }, [files, categoryOverrides, autoThreshold]);

  const needsReviewCount = useMemo(() => {
    return files.length - highConfidenceCount;
  }, [files.length, highConfidenceCount]);

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
    <div className="space-y-6 animate-fade-in max-w-7xl mx-auto pb-16">
      {/* Interactive Workflow Stepper */}
      <WorkflowStepper
        currentStep="review"
        inputFolder={inputFolder}
        fileCount={files.length}
        onNavigate={(step) => {
          if (step === "select_folder" && onNavigateToSelectFolder) onNavigateToSelectFolder();
          else if (step === "blueprint" && onNavigateToOrganize) onNavigateToOrganize();
        }}
      />

      {/* Header with Title, Breadcrumb, and Minimal Granularity Switcher */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-mono text-[#615d59] dark:text-[#9b9a97] mb-1">
            <span>Workspace</span>
            <span>/</span>
            <span className="text-[#0075de] dark:text-[#2383e2]">Review & Apply</span>
          </div>
          <h2 className="text-2xl md:text-3xl font-bold text-[#000000] dark:text-[#ffffff] tracking-heading-1">
            Review & Apply
          </h2>
          <p className="text-[14px] text-[#615d59] dark:text-[#9b9a97] mt-0.5">
            Inspect predictions, reassign categories directly, and batch organize files.
          </p>
        </div>

        {/* Minimal Granularity Switcher */}
        {complexityLevel && (
          <div className="flex items-center p-1 rounded-xl bg-[#f2f2f7] dark:bg-[#161618] border border-[#e5e5e7] dark:border-[#2c2c2e] shrink-0 self-start md:self-auto shadow-2xs">
            {[
              { id: "low", label: "Simple", icon: Grid2X2 },
              { id: "medium", label: "Balanced", icon: LayoutGrid },
              { id: "high", label: "Detailed", icon: Layers },
            ].map(({ id, label, icon: Icon }) => {
              const isSelected = complexityLevel === id;
              return (
                <button
                  key={id}
                  onClick={() => handleTierSelect(id as ComplexityLevel)}
                  disabled={isReclassifying}
                  className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer flex items-center gap-1.5 select-none ${
                    isSelected
                      ? "bg-[#ffffff] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs font-semibold"
                      : "text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                  }`}
                  title={`Switch to ${label} classification tier`}
                >
                  {isReclassifying && isSelected ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0075de] dark:text-[#38bdf8]" />
                  ) : (
                    <Icon className="w-3.5 h-3.5" />
                  )}
                  <span>{label}</span>
                </button>
              );
            })}
          </div>
        )}
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
            {highConfidenceCount}
          </p>
        </div>

        <div className="bg-[#ffffff] dark:bg-[#202020] p-4 rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
          <p className="text-[12px] font-semibold uppercase tracking-eyebrow text-[#dd5b00] dark:text-[#fb923c]">
            Needs Review
          </p>
          <p className="text-2xl font-bold text-[#dd5b00] dark:text-[#fb923c] mt-1">
            {needsReviewCount}
          </p>
        </div>
      </div>

      {/* Unrecognized Files Action Banner */}
      {unrecognizedFiles.length > 0 && (
        <div className="bg-[#ffffff] dark:bg-[#202020] p-4 rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] flex flex-col md:flex-row items-start md:items-center justify-between gap-4 animate-fade-in">
          <div className="flex items-center gap-3.5">
            <div className="p-2.5 rounded-xl bg-[#fff7ed] dark:bg-[#451a03]/40 text-[#c2410c] dark:text-[#fb923c] border border-[#ffedd5] dark:border-[#9a3412]/30 shrink-0">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-[14px] font-semibold text-[#000000] dark:text-[#ffffff]">
                  {unrecognizedFiles.length} Unrecognized File{unrecognizedFiles.length > 1 ? "s" : ""}
                </h4>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-[#fff7ed] dark:bg-[#451a03]/50 text-[#c2410c] dark:text-[#fb923c] border border-[#fed7aa]/60 dark:border-[#9a3412]/40">
                  Needs Attention
                </span>
              </div>
              <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97] mt-0.5">
                These files didn't match your active categories. You can auto-group them with AI or sort them manually.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full md:w-auto shrink-0">
            <button
              onClick={handleRunAiCluster}
              disabled={isClustering}
              className="flex-1 md:flex-none px-3.5 py-2 bg-[#0075de] hover:bg-[#005bab] text-white text-[12px] font-semibold rounded-lg shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-97 transition disabled:opacity-50"
            >
              {isClustering ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Clustering with AI...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Auto-Cluster with AI</span>
                </>
              )}
            </button>

            <button
              onClick={() => setIsTriageOpen(true)}
              className="flex-1 md:flex-none px-3.5 py-2 bg-[#ffffff] dark:bg-[#282828] hover:bg-[#f6f5f4] dark:hover:bg-[#333333] text-[#1d1d1f] dark:text-[#f5f5f7] border border-[#e6e6e6] dark:border-[#383838] text-[12px] font-medium rounded-lg shadow-2xs flex items-center justify-center gap-1.5 cursor-pointer active:scale-97 transition"
            >
              <span>Manual Triage Queue</span>
            </button>
          </div>
        </div>
      )}

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

        {/* Selection & Rename Quick Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {renameableFilesCount > 0 && (
            <button
              onClick={handleApplyAllSuggestedFilenames}
              title="Apply all AI suggested file renames"
              className="px-3 py-1 text-[12px] font-medium bg-[#0075de]/10 dark:bg-[#0075de]/20 hover:bg-[#0075de]/20 dark:hover:bg-[#0075de]/30 text-[#0075de] dark:text-[#38bdf8] rounded-md border border-[#0075de]/30 transition cursor-pointer flex items-center gap-1.5 active:scale-97"
            >
              <Sparkles className="w-3.5 h-3.5" />
              <span>Accept All AI Renames ({renameableFilesCount})</span>
            </button>
          )}

          {overriddenFilenamesCount > 0 && (
            <button
              onClick={handleRevertAllFilenames}
              title="Revert all custom / AI renames back to original names"
              className="px-2.5 py-1 text-[12px] font-medium text-[#86868b] hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded-md border border-[#e6e6e6] dark:border-[#383838] transition cursor-pointer flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Names ({overriddenFilenamesCount})</span>
            </button>
          )}

          {Object.keys(categoryOverrides).length > 0 && (
            <button
              onClick={() => setCategoryOverrides({})}
              title="Revert all manual / AI cluster assignments back to original scan predictions"
              className="px-2.5 py-1 text-[12px] font-medium text-[#86868b] hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded-md border border-[#e6e6e6] dark:border-[#383838] transition cursor-pointer flex items-center gap-1"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Reset Categories ({Object.keys(categoryOverrides).length})</span>
            </button>
          )}

          <button
            onClick={() => setIsHistoryOpen(true)}
            title="View category version history & restore previous snapshots"
            className="px-2.5 py-1 text-[12px] font-medium bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] text-[#1d1d1f] dark:text-[#f5f5f7] rounded-md border border-[#e6e6e6] dark:border-[#383838] transition cursor-pointer flex items-center gap-1.5 shadow-2xs"
          >
            <History className="w-3.5 h-3.5 text-[#0075de] dark:text-[#38bdf8]" />
            <span>History ({snapshots.length})</span>
          </button>

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

        {/* Category Filter Pills Row */}
        <div className="w-full pt-2.5 border-t border-[#e6e6e6]/80 dark:border-[#2e2e2e] flex items-center gap-1.5 overflow-x-auto pb-0.5 scrollbar-none text-[11.5px]">
          <span className="text-[11px] font-semibold text-[#86868b] uppercase tracking-wider shrink-0 mr-1">
            Categories:
          </span>
          <button
            onClick={() => setFilterCategory("all")}
            className={`px-2.5 py-1 rounded-lg border transition shrink-0 cursor-pointer flex items-center gap-1.5 ${
              filterCategory === "all"
                ? "bg-[#0075de] text-white border-[#0075de] shadow-2xs font-semibold"
                : "bg-[#f6f5f4] dark:bg-[#191919] text-[#615d59] dark:text-[#9b9a97] border-[#e6e6e6] dark:border-[#333333] hover:border-[#0075de]/40"
            }`}
          >
            <span>All</span>
            <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${filterCategory === "all" ? "bg-white/20 text-white" : "bg-[#e5e5ea] dark:bg-[#2c2c2e] text-[#615d59] dark:text-[#9b9a97]"}`}>
              {files.length}
            </span>
          </button>

          {uniqueCategories.map((c) => {
            const isSelected = filterCategory === c;
            const count = categoryCounts[c] || 0;
            return (
              <button
                key={c}
                onClick={() => setFilterCategory(isSelected ? "all" : c)}
                className={`px-2.5 py-1 rounded-lg border transition shrink-0 cursor-pointer flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-[#0075de] text-white border-[#0075de] shadow-2xs font-semibold"
                    : "bg-[#f6f5f4] dark:bg-[#191919] text-[#615d59] dark:text-[#9b9a97] border-[#e6e6e6] dark:border-[#333333] hover:border-[#0075de]/40"
                }`}
              >
                <span className="truncate max-w-[150px]" title={c}>{c}</span>
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? "bg-white/20 text-white" : "bg-[#e5e5ea] dark:bg-[#2c2c2e] text-[#615d59] dark:text-[#9b9a97]"}`}>
                  {count}
                </span>
              </button>
            );
          })}

          {/* Inline Add Category Folder */}
          {isAddingCategory ? (
            <form onSubmit={handleCreateCategory} className="flex items-center gap-1 shrink-0">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Folder name..."
                autoFocus
                className="bg-[#ffffff] dark:bg-[#191919] border border-[#0075de] text-[11.5px] rounded-lg px-2 py-0.5 text-[#000000] dark:text-[#ffffff] focus:outline-none w-32"
              />
              <button
                type="submit"
                className="px-2 py-0.5 bg-[#0075de] text-white rounded-lg text-[11px] font-bold cursor-pointer"
              >
                Add
              </button>
              <button
                type="button"
                onClick={() => { setIsAddingCategory(false); setNewCatName(""); }}
                className="text-[#86868b] hover:text-[#000000] dark:hover:text-[#ffffff] text-xs px-1 cursor-pointer"
              >
                ✕
              </button>
            </form>
          ) : (
            <button
              onClick={() => setIsAddingCategory(true)}
              className="px-2.5 py-1 rounded-lg border border-dashed border-[#d1d1d6] dark:border-[#383838] hover:border-[#0075de] text-[#86868b] hover:text-[#0075de] text-[11px] font-medium transition shrink-0 flex items-center gap-1 cursor-pointer"
              title="Create a new destination category folder"
            >
              <Plus className="w-3 h-3" />
              <span>New Folder</span>
            </button>
          )}
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
                  const isOverridden = Boolean(categoryOverrides[file.file_id] && categoryOverrides[file.file_id] !== "Unknown");
                  const effectiveConfidence = isOverridden ? 1.0 : file.confidence;
                  const isHighConf = effectiveConfidence >= autoThreshold && currentCat !== "Unknown";
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

                          <div className="min-w-0 max-w-sm flex-1">
                            {editingFileId === file.file_id ? (
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  value={editingFileName}
                                  onChange={(e) => setEditingFileName(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleSaveFilename(file.file_id);
                                    if (e.key === "Escape") setEditingFileId(null);
                                  }}
                                  autoFocus
                                  className="bg-[#f6f5f4] dark:bg-[#191919] border border-[#0075de] dark:border-[#38bdf8] rounded px-2 py-0.5 text-[12px] font-mono text-[#000000] dark:text-[#ffffff] focus:outline-none w-full"
                                />
                                <button
                                  onClick={() => handleSaveFilename(file.file_id)}
                                  title="Save Rename"
                                  className="p-1 text-[#1aae39] hover:bg-[#ecf7ed] dark:hover:bg-[#0c3917]/40 rounded cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  onClick={() => setEditingFileId(null)}
                                  title="Cancel"
                                  className="p-1 text-[#a39e98] hover:bg-[#f6f5f4] dark:hover:bg-[#282828] rounded cursor-pointer"
                                >
                                  <X className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            ) : (
                              <div className="group/name flex items-center gap-2 flex-wrap">
                                {filenameOverrides[file.file_id] ? (
                                  <>
                                    <span
                                      className="font-bold font-mono text-[12px] text-[#0075de] dark:text-[#38bdf8] truncate"
                                      title={`Renamed to: ${filenameOverrides[file.file_id]}`}
                                    >
                                      {filenameOverrides[file.file_id]}
                                    </span>
                                    <span
                                      className="text-[11px] font-mono text-[#86868b] line-through truncate max-w-[140px]"
                                      title={`Original: ${file.filename}`}
                                    >
                                      {file.filename}
                                    </span>
                                  </>
                                ) : (
                                  <span
                                    className="font-semibold font-mono text-[12px] text-[#000000] dark:text-[#ffffff] truncate"
                                    title={file.filename}
                                  >
                                    {file.filename}
                                  </span>
                                )}

                                <button
                                  onClick={() =>
                                    handleStartEditFilename(
                                      file.file_id,
                                      filenameOverrides[file.file_id] || file.filename
                                    )
                                  }
                                  title="Edit Filename Manually"
                                  className="opacity-0 group-hover/name:opacity-100 p-0.5 text-[#86868b] hover:text-[#0075de] dark:hover:text-[#38bdf8] transition cursor-pointer"
                                >
                                  <Edit2 className="w-3 h-3" />
                                </button>
                              </div>
                            )}

                            {/* Toggleable AI Rename Chip */}
                            {filenameOverrides[file.file_id] ? (
                              <button
                                onClick={() => handleRevertFilename(file.file_id)}
                                title="Click to deselect AI rename and keep original filename"
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 mt-1 rounded-md text-[11px] font-mono bg-[#0075de]/15 dark:bg-[#0075de]/25 text-[#0075de] dark:text-[#38bdf8] border border-[#0075de]/30 hover:bg-[#ff3b30]/15 hover:text-[#ff3b30] hover:border-[#ff3b30]/30 transition group/chip cursor-pointer"
                              >
                                <Check className="w-3 h-3 group-hover/chip:hidden text-[#0075de] dark:text-[#38bdf8]" />
                                <X className="w-3 h-3 hidden group-hover/chip:inline text-[#ff3b30]" />
                                <span>Rename active</span>
                                <span className="text-[10px] text-[#86868b] group-hover/chip:text-[#ff3b30]">(click to deselect ✕)</span>
                              </button>
                            ) : file.suggested_filename && file.suggested_filename !== file.filename ? (
                              <button
                                onClick={() =>
                                  handleApplySuggestedFilename(file.file_id, file.suggested_filename!)
                                }
                                title="Click to select AI suggested rename"
                                className="inline-flex items-center gap-1.5 px-2 py-0.5 mt-1 rounded-md text-[11px] font-mono bg-[#f2f2f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#a1a1a6] hover:bg-[#0075de]/10 hover:text-[#0075de] dark:hover:text-[#38bdf8] hover:border-[#0075de]/30 border border-transparent transition cursor-pointer"
                              >
                                <Sparkles className="w-3 h-3 text-[#0075de] dark:text-[#38bdf8]" />
                                <span>AI Suggests:</span>
                                <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">{file.suggested_filename}</span>
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </td>

                      {/* File Size */}
                      <td className="p-3 text-[#615d59] dark:text-[#9b9a97] font-mono text-[12px]">
                        {formatBytes(file.file_size_bytes)}
                      </td>

                      {/* Category Selector */}
                      <td className="p-3">
                        <div className="flex items-center gap-1.5">
                          <select
                            value={currentCat}
                            onChange={(e) => {
                              const newCat = e.target.value;
                              setCategoryOverrides((prev) => ({
                                ...prev,
                                [file.file_id]: newCat,
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

                          {categoryOverrides[file.file_id] && (
                            <button
                              onClick={() => {
                                setCategoryOverrides((prev) => {
                                  const next = { ...prev };
                                  delete next[file.file_id];
                                  return next;
                                });
                              }}
                              title={`Revert category to original: ${file.category}`}
                              className="p-1 text-[#86868b] hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 rounded transition cursor-pointer"
                            >
                              <RotateCcw className="w-3 h-3" />
                            </button>
                          )}
                        </div>
                      </td>

                      {/* Confidence Meter */}
                      <td className="p-3">
                        {isOverridden ? (
                          <div className="flex items-center gap-1.5">
                            <span className="px-1.5 py-0.5 rounded text-[10.5px] font-bold font-mono bg-[#0075de]/10 dark:bg-[#0075de]/20 text-[#0075de] dark:text-[#38bdf8] border border-[#0075de]/30 flex items-center gap-1">
                              <Sparkles className="w-2.5 h-2.5" />
                              <span>Assigned</span>
                            </span>
                            <span
                              className="text-[10px] text-[#86868b] font-mono"
                              title={`Original model score: ${Math.round(file.confidence * 100)}%`}
                            >
                              ({Math.round(file.confidence * 100)}%)
                            </span>
                          </div>
                        ) : (
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
                        )}
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

                      {/* Inspect & Reveal Actions */}
                      <td className="p-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setPreviewFile(file)}
                            className="p-1 text-[#a39e98] hover:text-[#0075de] dark:hover:text-[#2383e2] hover:bg-[#e8f4fd] dark:hover:bg-[#0c3966]/40 rounded-md transition cursor-pointer"
                            title="Inspect document text"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          <button
                            onClick={(e) => handleOpenInExplorer(file.abs_path, e)}
                            className="p-1 text-[#a39e98] hover:text-[#0075de] dark:hover:text-[#2383e2] hover:bg-[#e8f4fd] dark:hover:bg-[#0c3966]/40 rounded-md transition cursor-pointer"
                            title="Reveal in Finder / File Explorer"
                          >
                            <FolderOpen className="w-4 h-4" />
                          </button>
                        </div>
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
            className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm z-[99999] flex items-center justify-center p-4 animate-fade-in"
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
                      {formatBytes(previewFile.file_size_bytes)} · Category:{" "}
                      <strong>{categoryOverrides[previewFile.file_id] || previewFile.category}</strong>
                      {previewFile.confidence !== undefined && ` (${Math.round(previewFile.confidence * 100)}% confidence)`}
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
                {previewFile.reason && (
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97] mb-1">
                      Classification Summary
                    </h4>
                    <p className="text-[13px] text-[#000000] dark:text-[#ffffff] bg-[#f6f5f4] dark:bg-[#191919] p-3 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e]">
                      {previewFile.reason}
                    </p>
                  </div>
                )}

                {previewFile.extracted_text ? (
                  <div>
                    <h4 className="text-[11px] font-semibold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97] mb-1">
                      Extracted Text & OCR Content
                    </h4>
                    <pre className="text-[12px] font-mono text-[#31302e] dark:text-[#d4d4d4] bg-[#f6f5f4] dark:bg-[#191919] p-3 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e] whitespace-pre-wrap max-h-60 overflow-y-auto">
                      {previewFile.extracted_text}
                    </pre>
                  </div>
                ) : (
                  <div className="flex items-center justify-center p-6 text-[#615d59] dark:text-[#9b9a97] text-[13px]">
                    No extracted text snippet available for this file.
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-[#e6e6e6] dark:border-[#333333]">
                <button
                  type="button"
                  onClick={() => handleOpenInExplorer(previewFile.abs_path)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-[#0075de]/10 dark:bg-[#2383e2]/15 hover:bg-[#0075de]/20 text-[#0075de] dark:text-[#8bc5f8] text-[13px] font-semibold rounded-full cursor-pointer transition border border-[#0075de]/20"
                >
                  <FolderOpen className="w-4 h-4" />
                  <span>{openedPath === previewFile.abs_path ? "Opened in Finder!" : "Reveal in Finder"}</span>
                </button>
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
            className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm z-[99999] flex items-center justify-center p-4 animate-fade-in"
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
              <div className="flex gap-2.5 pt-1">
                <button
                  onClick={() => handleOpenInExplorer(applyResultModal.output_dir)}
                  className="flex-1 py-2.5 bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] text-[#000000] dark:text-[#ffffff] font-semibold text-[13px] rounded-full border border-[#e6e6e6] dark:border-[#333333] flex items-center justify-center gap-1.5 cursor-pointer transition"
                >
                  <FolderOpen className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
                  <span>Open Folder</span>
                </button>
                <button
                  onClick={() => setApplyResultModal(null)}
                  className="flex-1 py-2.5 bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] dark:hover:bg-[#1d70c2] text-white font-semibold text-[13px] rounded-full shadow-xs cursor-pointer transition"
                >
                  Done
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
      {/* Quick Triage Modal */}
      {isTriageOpen && (
        <QuickTriageModal
          files={unrecognizedFiles}
          categories={Object.keys(categories)}
          categoryOverrides={categoryOverrides}
          onAssignCategory={handleAssignInTriage}
          onClose={() => setIsTriageOpen(false)}
        />
      )}

      {/* AI Cluster Proposal Modal */}
      {clusterModalData &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/50 dark:bg-black/70 backdrop-blur-sm z-[99999] flex items-center justify-center p-4 animate-fade-in"
            onClick={() => setClusterModalData(null)}
          >
            <div
              className="bg-[#ffffff] dark:bg-[#1a1a1a] rounded-2xl border border-[#e6e6e6] dark:border-[#303030] max-w-2xl w-full p-6 shadow-2xl space-y-5 animate-scale-in text-left"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[#e6e6e6] dark:border-[#303030] pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 rounded-lg bg-[#f59e0b]/10 text-[#f59e0b]">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-bold text-[#000000] dark:text-[#ffffff]">
                      AI Discovered Cluster Folders
                    </h3>
                    <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97]">
                      {clusterModalData.message}
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => setClusterModalData(null)}
                  className="p-1.5 rounded-lg text-[#615d59] dark:text-[#9b9a97] hover:text-[#000000] dark:hover:text-[#ffffff] hover:bg-[#f0eee9] dark:hover:bg-[#282828] cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Cluster Groups List */}
              <div className="max-h-80 overflow-y-auto space-y-3 pr-1">
                {Object.entries(clusterModalData.clusters || {}).map(([catName, fileIds]) => (
                  <div
                    key={catName}
                    className="p-3.5 rounded-xl bg-[#f6f5f4] dark:bg-[#222222] border border-[#e6e6e6] dark:border-[#333333] space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <FolderCheck className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
                        <span className="text-sm font-bold text-[#000000] dark:text-[#ffffff]">
                          {catName}
                        </span>
                      </div>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-[#e8f4fd] dark:bg-[#0c3966]/40 text-[#0075de] dark:text-[#2383e2]">
                        {fileIds.length} file{fileIds.length > 1 ? "s" : ""}
                      </span>
                    </div>

                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {fileIds.map((fid) => {
                        const fileObj = files.find((f) => f.file_id === fid);
                        return (
                          <span
                            key={fid}
                            className="px-2 py-1 rounded-md bg-[#ffffff] dark:bg-[#181818] border border-[#e6e6e6] dark:border-[#383838] text-[11px] text-[#615d59] dark:text-[#b0b0b0] truncate max-w-xs"
                            title={fileObj?.filename || fid}
                          >
                            {fileObj?.filename || fid}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#e6e6e6] dark:border-[#303030]">
                <button
                  onClick={() => setClusterModalData(null)}
                  className="px-4 py-2 rounded-lg border border-[#e6e6e6] dark:border-[#333333] text-[12px] font-medium text-[#615d59] dark:text-[#9b9a97] hover:bg-[#f6f5f4] dark:hover:bg-[#282828] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleApplyClusters}
                  className="px-5 py-2 bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] text-white text-[12px] font-bold rounded-lg shadow-sm flex items-center gap-1.5 cursor-pointer active:scale-97 transition"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Apply Categories & Select All</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Success Celebration & Insights Modal */}
      {applyResultModal && (
        <ApplySuccessModal
          isOpen={Boolean(applyResultModal)}
          onClose={() => setApplyResultModal(null)}
          count={applyResultModal.count}
          action={applyResultModal.action}
          outputDir={applyResultModal.output_dir}
          onOpenFolder={(path) => handleOpenInExplorer(path)}
          onNavigateToSearch={() => {
            setApplyResultModal(null);
            if (onNavigateToSearch) onNavigateToSearch();
          }}
          onOrganizeAnother={() => {
            setApplyResultModal(null);
            if (onNavigateToSelectFolder) onNavigateToSelectFolder();
          }}
        />
      )}

      {/* Tier Switch Confirmation Modal */}
      {complexityLevel && (
        <TierChangeConfirmModal
          isOpen={isTierConfirmOpen}
          currentTier={complexityLevel}
          targetTier={pendingTier}
          currentCategories={categories}
          proposedCategories={proposedCategories}
          isLoadingProposal={isLoadingProposal}
          fileCount={files.length}
          onClose={() => {
            setIsTierConfirmOpen(false);
            setProposedCategories({});
          }}
          onConfirm={handleConfirmTierChange}
          context="review"
        />
      )}

      {/* Category Version History Modal */}
      <CategoryHistoryModal
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        snapshots={snapshots}
        currentCategories={categories}
        onRestoreSnapshot={handleRestoreSnapshot}
        onDeleteSnapshot={handleDeleteSnapshot}
        onClearHistory={handleClearHistory}
      />
    </div>
  );
};
