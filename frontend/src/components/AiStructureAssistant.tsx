import React, { useState, useRef } from "react";
import { CategoryItem, ComplexityLevel } from "../types";
import { API_BASE } from "../config";
import {
  PRESET_PACKS,
  DEFAULT_STANDARD_CATEGORIES,
} from "../utils/presetCategories";
import {
  FolderPlus,
  FolderTree,
  Trash2,
  Check,
  ArrowRight,
  Loader2,
  Sparkles,
  Grid2X2,
  LayoutGrid,
  Layers,
  Send,
  FileCode,
  CheckCircle2,
  Terminal,
  X,
  Plus,
  RotateCcw,
} from "lucide-react";

interface AiStructureAssistantProps {
  inputFolder: string;
  activeCategories: Record<string, CategoryItem>;
  setActiveCategories: (cats: Record<string, CategoryItem>) => void;
  customInstructions: string;
  setCustomInstructions: (instr: string) => void;
  onApproveAndOrganize: () => void;
  isRunning: boolean;
  backendStatus: string;
  complexityLevel?: ComplexityLevel;
  setComplexityLevel?: (lvl: ComplexityLevel) => void;
}

interface GranularityTier {
  id: ComplexityLevel;
  label: string;
  structure: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

const GRANULARITY_TIERS: GranularityTier[] = [
  {
    id: "low",
    label: "Simple",
    structure: "Flat Structure",
    description: "Clean, flat top-level folders with no nested subdirectories",
    icon: Grid2X2,
  },
  {
    id: "medium",
    label: "Balanced",
    structure: "Subfolders",
    description: "Functional organization with clean, 1-level subfolders",
    icon: LayoutGrid,
  },
  {
    id: "high",
    label: "Detailed",
    structure: "Deep Tree",
    description: "Deep multi-level hierarchy by topic, project, date & format",
    icon: Layers,
  },
];

const QUICK_ACTIONS = [
  { label: "Re-Scan Directory", prompt: "Re-scan all files in this directory and re-synthesize categories.", isAuto: true },
  { label: "Simplify Structure", prompt: "Consolidate into fewer, broader folders." },
  { label: "Split by Year / Date", prompt: "Create year-based subfolders where relevant." },
  { label: "Separate Work & Personal", prompt: "Split into distinct Work and Personal trees." },
  { label: "Add Custom Folder...", prompt: "Add a folder for " },
];

export const AiStructureAssistant: React.FC<AiStructureAssistantProps> = ({
  inputFolder,
  activeCategories,
  setActiveCategories,
  customInstructions,
  setCustomInstructions,
  onApproveAndOrganize,
  isRunning,
  backendStatus,
  complexityLevel = "medium",
  setComplexityLevel,
}) => {
  const [inputText, setInputText] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentLevel, setCurrentLevel] = useState<ComplexityLevel>(complexityLevel);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [isAddingFolder, setIsAddingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [activePresetId, setActivePresetId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const handleTierChange = (lvl: ComplexityLevel) => {
    setCurrentLevel(lvl);
    if (setComplexityLevel) {
      setComplexityLevel(lvl);
    }
  };

  // 1-Click Autonomous File Inspection & Taxonomy Synthesis
  const handleAutoSynthesize = async (lvl?: ComplexityLevel) => {
    const levelToUse = lvl || currentLevel;
    if (isProcessing || isRunning) return;

    setIsProcessing(true);
    setStatusMessage(`Scanning '${inputFolder || "directory"}' files & reading document previews...`);

    try {
      const payload = {
        message: `Analyze directory files and generate custom ${levelToUse} category taxonomy`,
        history: [],
        input_dir: inputFolder || undefined,
        current_categories: undefined,
        complexity_level: levelToUse,
        auto_discover: true,
      };

      const res = await fetch(`${API_BASE}/ai/chat-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Directory analysis failed");
      }

      const data = await res.json();
      const generatedCats: Record<string, CategoryItem> = {};

      if (data.categories && Object.keys(data.categories).length > 0) {
        Object.entries(data.categories).forEach(([name, c]: [string, any]) => {
          generatedCats[name] = {
            name: c.name || name,
            description: c.description || "",
            keywords: c.keywords || [],
            extensions: c.extensions || [],
            active: c.active !== false,
          };
        });
        setActiveCategories(generatedCats);
      }

      if (data.custom_instructions !== undefined) {
        setCustomInstructions(data.custom_instructions);
      }

      setStatusMessage(data.message || `Synthesized ${Object.keys(generatedCats).length} bespoke categories from your directory.`);
      setActivePresetId(null);
    } catch (err: any) {
      setStatusMessage(`Notice: ${err.message}.`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadPreset = (presetId: string, presetCats: Record<string, CategoryItem>) => {
    setActiveCategories(presetCats);
    setActivePresetId(presetId);
    setStatusMessage(`Loaded '${presetId.toUpperCase()}' preset template (${Object.keys(presetCats).length} folders).`);
  };

  const handleLoadStandard = () => {
    setActiveCategories(DEFAULT_STANDARD_CATEGORIES);
    setActivePresetId("standard");
    setStatusMessage(`Loaded standard 18-folder workspace template.`);
  };

  const handleExecuteCommand = async (commandToSend?: string) => {
    const text = (commandToSend || inputText).trim();
    if (!text || isProcessing) return;

    setIsProcessing(true);
    setInputText("");
    setStatusMessage(`Applying: "${text}"...`);

    try {
      const payload = {
        message: text,
        input_dir: inputFolder || undefined,
        current_categories: Object.keys(activeCategories).length > 0 ? activeCategories : undefined,
        complexity_level: currentLevel,
        auto_discover: false,
      };

      const res = await fetch(`${API_BASE}/ai/chat-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) throw new Error("Command failed");

      const data = await res.json();
      const generatedCats: Record<string, CategoryItem> = {};

      if (data.categories && Object.keys(data.categories).length > 0) {
        Object.entries(data.categories).forEach(([name, c]: [string, any]) => {
          generatedCats[name] = {
            name: c.name || name,
            description: c.description || "",
            keywords: c.keywords || [],
            extensions: c.extensions || [],
            active: c.active !== false,
          };
        });
        setActiveCategories(generatedCats);
      }

      if (data.custom_instructions !== undefined) {
        setCustomInstructions(data.custom_instructions);
      }

      setStatusMessage(data.message || "Categories updated.");
      setActivePresetId(null);
    } catch (err: any) {
      setStatusMessage(`Notice: ${err.message}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleToggleFolder = (name: string) => {
    const existing = activeCategories[name];
    if (!existing) return;
    setActiveCategories({
      ...activeCategories,
      [name]: { ...existing, active: !existing.active },
    });
  };

  const handleDeleteFolder = (name: string) => {
    const next = { ...activeCategories };
    delete next[name];
    setActiveCategories(next);
  };

  const handleAddFolderSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = newFolderName.trim();
    if (!clean) return;
    setActiveCategories({
      ...activeCategories,
      [clean]: {
        name: clean,
        description: `Custom folder: ${clean}`,
        keywords: [clean.toLowerCase()],
        extensions: [],
        active: true,
      },
    });
    setNewFolderName("");
    setIsAddingFolder(false);
  };

  const activeCount = Object.values(activeCategories).filter((c) => c.active).length;
  const hasCategories = Object.keys(activeCategories).length > 0;
  const folderName = inputFolder ? inputFolder.split("/").filter(Boolean).pop() || inputFolder : "Selected Folder";

  // --- 1. UNINITIALIZED STATE: DIRECTORY ANALYSIS HERO ---
  if (!hasCategories) {
    return (
      <div className="bg-[#ffffff] dark:bg-[#1c1c1e] rounded-2xl border border-[#e5e5e7] dark:border-[#2c2c2e] shadow-sm p-8 max-w-4xl mx-auto space-y-8 animate-fade-in">
        <div className="text-center space-y-3">
          <div className="w-14 h-14 mx-auto rounded-2xl bg-[#0075de]/10 dark:bg-[#0075de]/20 text-[#0075de] dark:text-[#38bdf8] flex items-center justify-center">
            <Sparkles className="w-7 h-7" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
              Analyze Directory & Synthesize Blueprint
            </h3>
            <p className="text-[13px] text-[#86868b] max-w-lg mx-auto mt-1 leading-relaxed">
              TidyFlow will inspect the actual filenames, document previews, and code files in{" "}
              <span className="font-mono text-[#0075de] dark:text-[#38bdf8] font-semibold">{folderName}</span> to generate bespoke categories.
            </p>
          </div>
        </div>

        {/* Granularity Selection Grid */}
        <div className="space-y-3">
          <label className="text-[12px] font-semibold uppercase tracking-wider text-[#86868b] block text-center">
            Choose Classification Granularity & Structure
          </label>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {GRANULARITY_TIERS.map((tier) => {
              const isSelected = currentLevel === tier.id;
              const Icon = tier.icon;
              return (
                <button
                  key={tier.id}
                  onClick={() => {
                    handleTierChange(tier.id);
                    if (inputFolder.trim() && !isProcessing) {
                      handleAutoSynthesize(tier.id);
                    }
                  }}
                  disabled={isProcessing}
                  className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex flex-col justify-between gap-3 ${
                    isSelected
                      ? "bg-[#0075de]/10 dark:bg-[#0075de]/20 border-[#0075de] dark:border-[#38bdf8] ring-1 ring-[#0075de]/50 shadow-xs"
                      : "bg-[#fafafc] dark:bg-[#242426] border-[#e5e5e7] dark:border-[#2c2c2e] hover:border-[#0075de]/50"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className={`p-2 rounded-lg ${isSelected ? "bg-[#0075de] text-white" : "bg-[#f2f2f7] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#98989d]"}`}>
                      {isProcessing && isSelected ? (
                        <Loader2 className="w-4 h-4 animate-spin text-[#0075de]" />
                      ) : (
                        <Icon className="w-4 h-4" />
                      )}
                    </div>
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#e5e5ea] dark:bg-[#2c2c2e] text-[#6e6e73] dark:text-[#98989d]">
                      {tier.structure}
                    </span>
                  </div>
                  <div>
                    <h4 className="text-[13.5px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
                      {tier.label}
                    </h4>
                    <p className="text-[11.5px] text-[#86868b] mt-0.5 leading-snug">
                      {tier.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Primary CTA Action */}
        <div className="pt-2 flex flex-col items-center gap-3">
          <button
            onClick={() => handleAutoSynthesize()}
            disabled={isProcessing || isRunning || !inputFolder.trim()}
            className="px-8 py-3.5 rounded-xl bg-[#0075de] hover:bg-[#0062bd] dark:bg-[#2383e2] dark:hover:bg-[#1a73cb] text-white font-bold text-[14px] flex items-center gap-2.5 transition shadow-sm cursor-pointer active:scale-[0.98] disabled:opacity-50"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Reading Directory Files & Synthesizing Taxonomy...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>Scan & Auto-Generate Categories for "{folderName}"</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          {statusMessage && (
            <p className="text-[12px] text-[#0075de] dark:text-[#38bdf8] font-mono animate-fade-in">
              {statusMessage}
            </p>
          )}

          {/* Secondary Preset Options */}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2 border-t border-[#e5e5e7] dark:border-[#2c2c2e] w-full text-[12px] text-[#86868b]">
            <span>Or start with pre-configured template:</span>
            <button
              onClick={handleLoadStandard}
              className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0075de] hover:underline cursor-pointer"
            >
              Standard 18 Folders
            </button>
            <span>•</span>
            {PRESET_PACKS.filter((p) => p.id !== "standard").map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleLoadPreset(preset.id, preset.categories)}
                className="font-medium text-[#1d1d1f] dark:text-[#f5f5f7] hover:text-[#0075de] hover:underline cursor-pointer"
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // --- 2. ACTIVE TAXONOMY BLUEPRINT STUDIO (WHEN CATEGORIES ARE POPULATED) ---
  return (
    <div className="bg-[#ffffff] dark:bg-[#1c1c1e] rounded-2xl border border-[#e5e5e7] dark:border-[#2c2c2e] shadow-sm overflow-hidden flex flex-col transition-all">
      {/* Studio Header Bar */}
      <div className="px-5 py-4 border-b border-[#e5e5e7] dark:border-[#2c2c2e] flex flex-wrap items-center justify-between gap-4 bg-[#fafafc] dark:bg-[#202022]">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#0075de]/10 dark:bg-[#0075de]/20 text-[#0075de] dark:text-[#38bdf8] flex items-center justify-center font-bold">
            <FolderTree className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[14px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] tracking-tight">
                Taxonomy Blueprint ({folderName})
              </h3>
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-full bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8]">
                {activeCount} active folders
              </span>
            </div>
            <p className="text-[12px] text-[#86868b]">
              Folders synthesized from real directory files. Customize, add, or refine below.
            </p>
          </div>
        </div>

        {/* Tactile Granularity Segmented Switcher */}
        <div className="flex items-center p-1 rounded-xl bg-[#f2f2f7] dark:bg-[#161618] border border-[#e5e5e7] dark:border-[#2c2c2e]">
          {GRANULARITY_TIERS.map((tier) => {
            const isSelected = currentLevel === tier.id;
            const Icon = tier.icon;
            return (
              <button
                key={tier.id}
                onClick={() => {
                  handleTierChange(tier.id);
                  handleAutoSynthesize(tier.id);
                }}
                disabled={isProcessing}
                className={`px-3 py-1.5 rounded-lg text-[12px] font-medium transition-all cursor-pointer flex items-center gap-1.5 select-none ${
                  isSelected
                    ? "bg-[#ffffff] dark:bg-[#2c2c2e] text-[#1d1d1f] dark:text-[#f5f5f7] shadow-xs font-semibold"
                    : "text-[#6e6e73] dark:text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7]"
                }`}
                title={`Switch to ${tier.label} (${tier.structure}): ${tier.description}`}
              >
                {isProcessing && isSelected ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0075de] dark:text-[#38bdf8]" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
                <span>{tier.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Action Control Sub-bar */}
      <div className="px-5 py-2.5 border-b border-[#e5e5e7] dark:border-[#2c2c2e] bg-[#ffffff] dark:bg-[#1c1c1e] flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => handleAutoSynthesize()}
            disabled={isProcessing || isRunning}
            className="px-3 py-1 rounded-lg bg-[#f2f2f7] dark:bg-[#2c2c2e] hover:bg-[#e5e5ea] dark:hover:bg-[#38383a] text-[#1d1d1f] dark:text-[#f5f5f7] text-[11.5px] font-medium flex items-center gap-1.5 transition cursor-pointer border border-[#e5e5e7] dark:border-[#38383a]"
          >
            {isProcessing ? <Loader2 className="w-3 h-3 animate-spin" /> : <RotateCcw className="w-3 h-3 text-[#0075de]" />}
            <span>Re-Analyze Files</span>
          </button>

          <button
            onClick={handleLoadStandard}
            disabled={isProcessing || isRunning}
            className={`px-2.5 py-1 rounded-lg text-[11.5px] font-medium transition cursor-pointer border ${
              activePresetId === "standard"
                ? "bg-[#0075de]/10 border-[#0075de] text-[#0075de]"
                : "border-[#e5e5e7] dark:border-[#2c2c2e] text-[#6e6e73] dark:text-[#98989d] hover:bg-[#f2f2f7] dark:hover:bg-[#2c2c2e]"
            }`}
          >
            Load Standard 18
          </button>

          <button
            onClick={() => setActiveCategories({})}
            className="px-3 py-1 rounded-lg bg-[#ff3b30]/10 hover:bg-[#ff3b30]/20 dark:bg-[#ff453a]/15 dark:hover:bg-[#ff453a]/25 text-[#ff3b30] dark:text-[#ff453a] border border-[#ff3b30]/30 hover:border-[#ff3b30]/60 text-[11.5px] font-semibold flex items-center gap-1.5 transition cursor-pointer active:scale-97 shadow-2xs"
            title="Clear all categories in current blueprint"
          >
            <Trash2 className="w-3.5 h-3.5 text-[#ff3b30] dark:text-[#ff453a]" />
            <span>Clear Blueprint</span>
          </button>
        </div>

        {/* Add Folder Inline Button */}
        <button
          onClick={() => {
            setIsAddingFolder(true);
            setTimeout(() => inputRef.current?.focus(), 50);
          }}
          className="px-2.5 py-1 rounded-lg border border-[#e5e5e7] dark:border-[#2c2c2e] hover:border-[#0075de] dark:hover:border-[#38bdf8] bg-[#fafafc] dark:bg-[#252528] text-[11.5px] font-medium text-[#48484a] dark:text-[#d1d1d6] flex items-center gap-1.5 transition cursor-pointer"
        >
          <Plus className="w-3.5 h-3.5 text-[#0075de] dark:text-[#38bdf8]" />
          <span>New Folder</span>
        </button>
      </div>

      {/* Main Folder Blueprint Grid */}
      <div className="p-5 flex-1 bg-[#ffffff] dark:bg-[#1c1c1e] min-h-[260px] max-h-[460px] overflow-y-auto space-y-4">
        {/* Inline Add Folder Form */}
        {isAddingFolder && (
          <form
            onSubmit={handleAddFolderSubmit}
            className="p-3 rounded-xl border border-[#0075de] dark:border-[#38bdf8] bg-[#0075de]/5 dark:bg-[#0075de]/10 flex items-center gap-2"
          >
            <FolderPlus className="w-4 h-4 text-[#0075de] dark:text-[#38bdf8] shrink-0" />
            <input
              ref={inputRef}
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Work/Reports or Invoices_2026"
              className="flex-1 bg-transparent text-[13px] font-mono text-[#1d1d1f] dark:text-[#f5f5f7] focus:outline-none placeholder-[#86868b]"
            />
            <button
              type="submit"
              className="px-3 py-1 bg-[#0075de] text-white text-[11px] font-semibold rounded-md cursor-pointer"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => setIsAddingFolder(false)}
              className="p-1 text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </form>
        )}

        {/* Folder Cards Grid OR Synthesizing Canvas */}
        {isProcessing ? (
          <div className="py-12 px-6 flex flex-col items-center justify-center text-center space-y-5 rounded-2xl bg-[#f2f2f7]/50 dark:bg-[#161618]/50 border border-[#0075de]/30 dark:border-[#0075de]/40">
            <div className="w-14 h-14 rounded-2xl bg-[#0075de]/15 dark:bg-[#0075de]/25 text-[#0075de] dark:text-[#38bdf8] flex items-center justify-center shadow-xs">
              <Loader2 className="w-7 h-7 animate-spin" />
            </div>
            <div className="space-y-1.5 max-w-lg">
              <h4 className="text-base font-bold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center justify-center gap-2">
                <span>Synthesizing {GRANULARITY_TIERS.find((t) => t.id === currentLevel)?.label || "Custom"} Taxonomy...</span>
              </h4>
              <p className="text-[13px] text-[#0075de] dark:text-[#38bdf8] font-mono leading-relaxed">
                {statusMessage || `Deep scanning directory files & reading content excerpts for "${folderName}"...`}
              </p>
              <p className="text-[11.5px] text-[#86868b] pt-1">
                Analyzing file types, dates, projects, and keywords to create tailored folders.
              </p>
            </div>

            {/* Shimmer skeleton mini cards preview */}
            <div className="w-full max-w-2xl grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 opacity-60">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className="h-20 rounded-xl bg-[#e5e5ea]/60 dark:bg-[#2c2c2e]/60 border border-[#e5e5e7] dark:border-[#38383a] animate-pulse p-3 flex flex-col justify-between"
                >
                  <div className="h-3.5 bg-[#d1d1d6] dark:bg-[#3a3a3c] rounded w-2/3" />
                  <div className="h-2.5 bg-[#e5e5ea] dark:bg-[#2c2c2e] rounded w-full" />
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {Object.entries(activeCategories).map(([name, cat]) => {
              return (
                <div
                  key={name}
                  className={`p-3.5 rounded-xl border transition-all duration-150 flex flex-col justify-between gap-2.5 ${
                    cat.active
                      ? "bg-[#fafafc] dark:bg-[#222224] border-[#e5e5e7] dark:border-[#2c2c2e] hover:border-[#0075de]/40 hover:shadow-xs"
                      : "bg-[#f2f2f7]/50 dark:bg-[#161618]/50 border-[#e5e5e7]/60 dark:border-[#2c2c2e]/40 opacity-50"
                  }`}
                >
                  {/* Card Top: Checkbox, Name, Delete */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        onClick={() => handleToggleFolder(name)}
                        className={`w-4 h-4 rounded flex items-center justify-center border transition-all cursor-pointer ${
                          cat.active
                            ? "bg-[#0075de] border-[#0075de] text-white"
                            : "border-[#c7c7cc] dark:border-[#48484a] bg-transparent"
                        }`}
                        title={cat.active ? "Click to disable" : "Click to enable"}
                      >
                        {cat.active && <Check className="w-3 h-3 stroke-[3]" />}
                      </button>
                      <span className="font-mono text-[12.5px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] truncate">
                        {name}
                      </span>
                    </div>

                    <button
                      onClick={() => handleDeleteFolder(name)}
                      className="text-[#86868b] hover:text-[#ff3b30] p-1 rounded transition cursor-pointer shrink-0"
                      title="Remove folder"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Card Middle: Description */}
                  {cat.description && (
                    <p className="text-[11px] text-[#6e6e73] dark:text-[#98989d] line-clamp-1 leading-snug">
                      {cat.description}
                    </p>
                  )}

                  {/* Card Bottom: Extensions & Keywords */}
                  <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[10px] font-mono">
                    {cat.extensions && cat.extensions.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-[#e5e5ea] dark:bg-[#2c2c2e] text-[#48484a] dark:text-[#d1d1d6] flex items-center gap-1">
                        <FileCode className="w-2.5 h-2.5 text-[#86868b]" />
                        <span>{cat.extensions.slice(0, 3).join(", ")}</span>
                      </span>
                    )}
                    {cat.keywords && cat.keywords.length > 0 && (
                      <span className="px-1.5 py-0.5 rounded bg-[#f2f2f7] dark:bg-[#1a1a1c] text-[#6e6e73] dark:text-[#86868b]">
                        {cat.keywords.slice(0, 2).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Custom Behavioral Rule Quote if present */}
        {customInstructions && (
          <div className="p-3 rounded-xl border border-[#0075de]/20 bg-[#0075de]/5 dark:bg-[#0075de]/10 flex items-start gap-2.5">
            <Terminal className="w-4 h-4 text-[#0075de] dark:text-[#38bdf8] shrink-0 mt-0.5" />
            <div className="flex-1">
              <span className="text-[11px] font-mono font-bold uppercase tracking-wider text-[#0075de] dark:text-[#38bdf8] block">
                Active Classification Rule
              </span>
              <p className="text-[12px] text-[#1d1d1f] dark:text-[#f5f5f7] mt-0.5">
                "{customInstructions}"
              </p>
            </div>
            <button
              onClick={() => setCustomInstructions("")}
              className="text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] text-[11px] font-medium"
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Assistant Status & Quick Prompt Chips */}
      <div className="px-5 py-2.5 border-t border-[#e5e5e7] dark:border-[#2c2c2e] bg-[#fafafc] dark:bg-[#202022] flex flex-wrap items-center justify-between gap-3 text-[11.5px]">
        <div className="flex items-center gap-2 text-[#6e6e73] dark:text-[#98989d] truncate">
          {isProcessing ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin text-[#0075de] dark:text-[#38bdf8] shrink-0" />
              <span className="text-[#0075de] dark:text-[#38bdf8] font-medium truncate">
                {statusMessage || `Synthesizing ${currentLevel} taxonomy...`}
              </span>
            </>
          ) : (
            <>
              <div className="w-2 h-2 rounded-full bg-[#34c759] shrink-0" />
              <span className="truncate">{statusMessage || `Taxonomy ready. ${activeCount} active categories.`}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto">
          {QUICK_ACTIONS.map((action, idx) => (
            <button
              key={idx}
              onClick={() => {
                if (action.isAuto) {
                  handleAutoSynthesize();
                } else if (action.prompt.endsWith(" ")) {
                  setInputText(action.prompt);
                } else {
                  handleExecuteCommand(action.prompt);
                }
              }}
              disabled={isProcessing || isRunning}
              className="px-2 py-0.5 rounded-md bg-[#ffffff] dark:bg-[#2c2c2e] border border-[#e5e5e7] dark:border-[#38383a] text-[#48484a] dark:text-[#d1d1d6] hover:border-[#0075de] hover:text-[#0075de] dark:hover:text-[#38bdf8] transition text-[11px] font-medium cursor-pointer shrink-0 disabled:opacity-50"
            >
              {action.label}
            </button>
          ))}
        </div>
      </div>

      {/* Command Bar & Organizer CTA Footer */}
      <div className="p-4 border-t border-[#e5e5e7] dark:border-[#2c2c2e] bg-[#ffffff] dark:bg-[#1c1c1e] flex flex-wrap items-center justify-between gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleExecuteCommand();
          }}
          className="flex-1 min-w-[280px] relative flex items-center"
        >
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Type a refinement command (e.g. 'Remove Archives', 'Group invoices by month', 'Simplify')..."
            disabled={isProcessing || isRunning}
            className="w-full bg-[#f2f2f7] dark:bg-[#252528] border border-transparent focus:border-[#0075de] dark:focus:border-[#38bdf8] rounded-xl pl-3.5 pr-10 py-2.5 text-[12.5px] text-[#1d1d1f] dark:text-[#f5f5f7] placeholder-[#86868b] focus:outline-none transition"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isProcessing || isRunning}
            className="absolute right-1.5 p-1.5 rounded-lg bg-[#0075de] text-white hover:bg-[#0062bd] disabled:opacity-40 transition cursor-pointer"
            title="Execute command"
          >
            <Send className="w-3 h-3" />
          </button>
        </form>

        <button
          onClick={onApproveAndOrganize}
          disabled={isRunning || isProcessing || backendStatus !== "running" || activeCount === 0 || !inputFolder.trim()}
          className={`px-5 py-2.5 rounded-xl font-semibold text-[13px] flex items-center gap-2 transition cursor-pointer shadow-xs select-none ${
            isRunning || isProcessing || backendStatus !== "running" || activeCount === 0 || !inputFolder.trim()
              ? "bg-[#e5e5ea] dark:bg-[#2c2c2e] text-[#86868b] cursor-not-allowed"
              : "bg-[#0075de] hover:bg-[#0062bd] dark:bg-[#2383e2] dark:hover:bg-[#1a73cb] text-white active:scale-[0.98]"
          }`}
        >
          {isRunning ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Organizing...</span>
            </>
          ) : isProcessing ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>Synthesizing Taxonomy...</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Approve & Organize ({activeCount} Folders)</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </>
          )}
        </button>
      </div>
    </div>
  );
};
