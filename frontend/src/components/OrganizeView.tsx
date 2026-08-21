import React, { useState, useEffect } from "react";
import { CategoryItem, RunSummary } from "../types";
import { getStickerStyle } from "../utils/stickerTheme";
import { AiStructureAssistant } from "./AiStructureAssistant";
import { DirectoryPickerModal } from "./DirectoryPickerModal";
import {
  Folder,
  FolderOpen,
  FolderDown,
  FileSearch,
  ArrowRight,
  ShieldCheck,
  Terminal,
  Layers,
  Loader2,
  Sparkles,
  SlidersHorizontal,
} from "lucide-react";

interface OrganizeViewProps {
  inputFolder: string;
  setInputFolder: (path: string) => void;
  outputFolder: string;
  setOutputFolder: (path: string) => void;
  useLlm: boolean;
  setUseLlm: (val: boolean) => void;
  isRunning: boolean;
  currentStage: string;
  progressLogs: string[];
  categories: Record<string, CategoryItem>;
  setCategories: React.Dispatch<React.SetStateAction<Record<string, CategoryItem>>>;
  customInstructions: string;
  setCustomInstructions: (val: string) => void;
  summary: RunSummary | null;
  backendStatus: string;
  onStartPipeline: (customCats?: Record<string, CategoryItem>, instructions?: string) => void;
  onNavigateToReview: () => void;
  onNavigateToCategories: () => void;
}

export const OrganizeView: React.FC<OrganizeViewProps> = ({
  inputFolder,
  setInputFolder,
  outputFolder,
  setOutputFolder,
  useLlm,
  setUseLlm,
  isRunning,
  currentStage,
  progressLogs,
  categories,
  setCategories,
  customInstructions,
  setCustomInstructions,
  summary,
  backendStatus,
  onStartPipeline,
  onNavigateToReview,
  onNavigateToCategories,
}) => {
  const [organizeMode, setOrganizeMode] = useState<"ai_architect" | "standard">("ai_architect");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<"source" | "destination">("source");
  const [quickLocations, setQuickLocations] = useState<Array<{ name: string; path: string }>>([]);

  // Fetch system quick locations for preset pills
  useEffect(() => {
    fetch("http://localhost:8000/fs/quick-locations")
      .then((res) => res.json())
      .then((data) => {
        if (data.locations) {
          setQuickLocations(data.locations);
        }
      })
      .catch((err) => console.error("Failed to load quick locations:", err));
  }, []);

  const handleSelectDirectory = (path: string) => {
    if (pickerTarget === "source") {
      setInputFolder(path);
      // Auto-set destination if empty or defaulted
      if (!outputFolder || outputFolder.endsWith("/Organized_Output")) {
        setOutputFolder(`${path}/Organized_Output`);
      }
    } else {
      setOutputFolder(path);
    }
  };

  const activeCategoryCount = Object.values(categories).filter((c) => c.active).length;

  return (
    <div className="space-y-6">
      {/* Directory Picker Modal */}
      <DirectoryPickerModal
        isOpen={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelectDirectory}
        initialPath={pickerTarget === "source" ? inputFolder : outputFolder}
        title={pickerTarget === "source" ? "Select Source Directory" : "Select Destination Directory"}
        description={
          pickerTarget === "source"
            ? "Choose the messy folder you want TidyFlow to scan and organize."
            : "Choose where organized category folders and reports should be created."
        }
      />

      {/* Mode Switcher Banner */}
      <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-3 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[#0075de]/10 dark:bg-[#2383e2]/15 flex items-center justify-center text-[#0075de] dark:text-[#8bc5f8]">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-[13px] font-semibold text-[#000000] dark:text-[#ffffff]">
              Organization Strategy
            </h3>
            <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97]">
              Choose how you want to build and command your folder taxonomy
            </p>
          </div>
        </div>

        <div className="flex items-center bg-[#f6f5f4] dark:bg-[#191919] p-1 rounded-lg border border-[#e6e6e6] dark:border-[#333333]">
          <button
            onClick={() => setOrganizeMode("ai_architect")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all cursor-pointer ${
              organizeMode === "ai_architect"
                ? "bg-[#ffffff] dark:bg-[#2c2c2c] text-[#0075de] dark:text-[#8bc5f8] shadow-2xs"
                : "text-[#615d59] dark:text-[#9b9a97] hover:text-[#000000] dark:hover:text-[#ffffff]"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5 text-[#0075de] dark:text-[#2383e2]" />
            <span>AI Organization Architect</span>
            <span className="text-[9px] bg-[#0075de]/15 text-[#0075de] dark:text-[#8bc5f8] px-1 py-0.2 rounded font-bold uppercase">
              New
            </span>
          </button>

          <button
            onClick={() => setOrganizeMode("standard")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-semibold transition-all cursor-pointer ${
              organizeMode === "standard"
                ? "bg-[#ffffff] dark:bg-[#2c2c2c] text-[#000000] dark:text-[#ffffff] shadow-2xs"
                : "text-[#615d59] dark:text-[#9b9a97] hover:text-[#000000] dark:hover:text-[#ffffff]"
            }`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" />
            <span>Standard Presets</span>
          </button>
        </div>
      </div>

      {/* Directory Path Configuration Card */}
      <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Input Source Folder */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[13px] font-semibold text-[#000000] dark:text-[#ffffff] flex items-center gap-1.5">
                <FolderOpen className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
                <span>Source Directory</span>
              </label>
              <span className="text-[10px] text-[#a39e98] uppercase font-bold tracking-wider">Required</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={inputFolder}
                onChange={(e) => setInputFolder(e.target.value)}
                placeholder="/Users/username/Downloads"
                className="flex-1 bg-[#ffffff] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3 py-2 text-[12px] font-mono text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] shadow-2xs"
              />
              <button
                type="button"
                onClick={() => {
                  setPickerTarget("source");
                  setPickerOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] border border-[#e6e6e6] dark:border-[#383838] rounded-md text-[12px] font-semibold text-[#31302e] dark:text-[#d4d4d4] transition cursor-pointer shadow-2xs shrink-0"
                title="Browse folder via popup or native Finder"
              >
                <Folder className="w-3.5 h-3.5 text-[#0075de] dark:text-[#2383e2]" />
                <span>Browse...</span>
              </button>
            </div>

            {/* Quick Location Presets */}
            {quickLocations.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-2">
                <span className="text-[11px] text-[#615d59] dark:text-[#9b9a97] mr-1">Bookmarks:</span>
                {quickLocations.map((loc) => {
                  const isSelected = inputFolder === loc.path;
                  return (
                    <button
                      key={loc.path}
                      onClick={() => {
                        setInputFolder(loc.path);
                        setOutputFolder(`${loc.path}/Organized_Output`);
                      }}
                      className={`text-[11px] px-2 py-0.5 rounded font-mono border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-[#0075de] text-white border-[#0075de] font-semibold shadow-2xs"
                          : "bg-[#f6f5f4] dark:bg-[#282828] text-[#31302e] dark:text-[#d4d4d4] border-[#e6e6e6] dark:border-[#383838] hover:bg-[#eae8e5] dark:hover:bg-[#333333]"
                      }`}
                    >
                      {loc.name}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Output Destination Folder */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-[13px] font-semibold text-[#000000] dark:text-[#ffffff] flex items-center gap-1.5">
                <FolderDown className="w-4 h-4 text-[#9b51e0] dark:text-[#d8b4fe]" />
                <span>Destination Directory</span>
              </label>
              <span className="text-[10px] text-[#a39e98] uppercase font-bold tracking-wider">Auto-Created</span>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={outputFolder}
                onChange={(e) => setOutputFolder(e.target.value)}
                placeholder="/Users/username/Organized_Output"
                className="flex-1 bg-[#ffffff] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3 py-2 text-[12px] font-mono text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] shadow-2xs"
              />
              <button
                type="button"
                onClick={() => {
                  setPickerTarget("destination");
                  setPickerOpen(true);
                }}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] border border-[#e6e6e6] dark:border-[#383838] rounded-md text-[12px] font-semibold text-[#31302e] dark:text-[#d4d4d4] transition cursor-pointer shadow-2xs shrink-0"
                title="Browse destination directory"
              >
                <FolderDown className="w-3.5 h-3.5 text-[#9b51e0] dark:text-[#d8b4fe]" />
                <span>Browse...</span>
              </button>
            </div>
            <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] mt-2">
              Organized subfolders and review reports will be generated here.
            </p>
          </div>
        </div>
      </div>

      {/* Main Workspace Body based on Mode */}
      {organizeMode === "ai_architect" ? (
        /* AI Conversational Assistant Mode */
        <AiStructureAssistant
          inputFolder={inputFolder}
          activeCategories={categories}
          setActiveCategories={setCategories}
          customInstructions={customInstructions}
          setCustomInstructions={setCustomInstructions}
          onApproveAndOrganize={() => onStartPipeline(categories, customInstructions)}
          isRunning={isRunning}
          backendStatus={backendStatus}
        />
      ) : (
        /* Standard Taxonomy Mode */
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <div className="lg:col-span-2 space-y-5">
            <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)] space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <label className="flex items-center gap-3 cursor-pointer select-none">
                  <div className="relative inline-flex items-center">
                    <input
                      type="checkbox"
                      checked={useLlm}
                      onChange={(e) => setUseLlm(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#e6e6e6] dark:bg-[#383838] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#0075de] dark:peer-checked:bg-[#2383e2]"></div>
                  </div>
                  <div>
                    <span className="text-[13px] font-semibold text-[#000000] dark:text-[#ffffff] flex items-center gap-1.5">
                      <FileSearch className="w-3.5 h-3.5 text-[#0075de] dark:text-[#2383e2]" />
                      Deep Content Inspection
                    </span>
                    <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97]">
                      Analyzes document text and OCR when rules are uncertain.
                    </p>
                  </div>
                </label>

                <button
                  onClick={() => onStartPipeline()}
                  disabled={isRunning || backendStatus !== "running" || !inputFolder.trim()}
                  className={`px-6 py-2.5 rounded-full font-semibold text-[14px] flex items-center gap-2 shadow-sm transition-all cursor-pointer ${
                    isRunning || backendStatus !== "running" || !inputFolder.trim()
                      ? "bg-[#e6e6e6] dark:bg-[#333333] text-[#a39e98] cursor-not-allowed"
                      : "bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] text-white active:scale-97 shadow-[0_2px_4px_rgba(0,117,222,0.25)]"
                  }`}
                >
                  {isRunning ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>Processing Directory...</span>
                    </>
                  ) : (
                    <>
                      <span>Start Organizing</span>
                      <ArrowRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Taxonomy Preview */}
          <div className="space-y-5">
            <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)]">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-[14px] font-semibold text-[#000000] dark:text-[#ffffff] flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-[#615d59] dark:text-[#9b9a97]" />
                  <span>Standard Categories</span>
                </h3>
                <button
                  onClick={onNavigateToCategories}
                  className="text-[12px] font-medium text-[#0075de] dark:text-[#2383e2] hover:underline cursor-pointer"
                >
                  Manage ({activeCategoryCount})
                </button>
              </div>
              <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] mb-3">
                Pre-configured standard taxonomy folders:
              </p>
              <div className="flex flex-wrap gap-1.5 max-h-52 overflow-y-auto pr-1">
                {Object.entries(categories).map(([name, cat]) => {
                  const style = getStickerStyle(name);
                  return (
                    <span
                      key={name}
                      className={`text-[11px] px-2 py-1 rounded-md font-medium flex items-center gap-1.5 border transition ${
                        cat.active
                          ? `${style.bg} ${style.text} ${style.border}`
                          : "bg-[#f6f5f4] dark:bg-[#252525] text-[#a39e98] border-[#e6e6e6] dark:border-[#333333] line-through opacity-60"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${cat.active ? style.dot : "bg-[#a39e98]"}`} />
                      <span>{name}</span>
                    </span>
                  );
                })}
              </div>
            </div>

            {/* Safety Callout Box */}
            <div className="bg-[#f6f5f4] dark:bg-[#252525] rounded-xl border border-[#e6e6e6] dark:border-[#333333] p-4 flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-[#ffffff] dark:bg-[#202020] border border-[#e6e6e6] dark:border-[#333333] flex items-center justify-center shrink-0 shadow-xs">
                <ShieldCheck className="w-4 h-4 text-[#1aae39] dark:text-[#4ade80]" />
              </div>
              <div>
                <h4 className="text-[13px] font-semibold text-[#000000] dark:text-[#ffffff]">
                  Safe Copy by Default
                </h4>
                <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] mt-0.5 leading-relaxed">
                  TidyFlow copies files by default. Your original source folder is preserved until you explicitly review and choose.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Execution Telemetry Log */}
      {(isRunning || progressLogs.length > 0) && (
        <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-5 shadow-[0_4px_14px_rgba(0,0,0,0.04)] dark:shadow-[0_4px_14px_rgba(0,0,0,0.4)] space-y-3">
          <div className="flex items-center justify-between border-b border-[#e6e6e6] dark:border-[#2e2e2e] pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-[#f6f5f4] dark:bg-[#282828] border border-[#e6e6e6] dark:border-[#383838] flex items-center justify-center">
                <Terminal className="w-3.5 h-3.5 text-[#0075de] dark:text-[#2383e2]" />
              </div>
              <div>
                <h3 className="text-[13px] font-semibold text-[#000000] dark:text-[#ffffff]">
                  {currentStage || "Pipeline Running"}
                </h3>
                <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97]">Execution telemetry</p>
              </div>
            </div>

            {summary && (
              <button
                onClick={onNavigateToReview}
                className="px-4 py-1.5 text-[12px] bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] text-white font-semibold rounded-full shadow-xs flex items-center gap-1.5 cursor-pointer"
              >
                <span>View Results in Review Table</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="bg-[#f6f5f4] dark:bg-[#191919] rounded-lg p-3.5 font-mono text-[12px] text-[#31302e] dark:text-[#d4d4d4] max-h-52 overflow-y-auto space-y-1 border border-[#e6e6e6] dark:border-[#2e2e2e]">
            {progressLogs.map((log, i) => (
              <div
                key={i}
                className={
                  log.startsWith("✓")
                    ? "text-[#166534] dark:text-[#4ade80] font-semibold"
                    : log.startsWith("✗")
                    ? "text-[#9d174d] dark:text-[#f472b6] font-semibold"
                    : "text-[#615d59] dark:text-[#9b9a97]"
                }
              >
                {log}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
