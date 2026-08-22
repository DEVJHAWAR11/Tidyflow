import React, { useState } from "react";
import { CategoryItem, RunSummary } from "../types";
import { getStickerStyle } from "../utils/stickerTheme";
import { AiStructureAssistant } from "./AiStructureAssistant";
import { WorkflowStepper } from "./WorkflowStepper";
import { ScanProgressOverlay } from "./ScanProgressOverlay";
import {
  FolderOpen,
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
  onChangeFolder?: () => void;
  fileCount?: number;
}

export const OrganizeView: React.FC<OrganizeViewProps> = ({
  inputFolder,
  outputFolder,
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
  onChangeFolder,
  fileCount = 0,
}) => {
  const [organizeMode, setOrganizeMode] = useState<"ai_architect" | "standard">("ai_architect");
  const activeCategoryCount = Object.values(categories).filter((c) => c.active).length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Live Scan & AI Analysis Progress Overlay */}
      <ScanProgressOverlay
        isRunning={isRunning}
        currentStage={currentStage}
        progressLogs={progressLogs}
        inputFolder={inputFolder}
      />

      {/* Interactive Workflow Stepper */}
      <WorkflowStepper
        currentStep="blueprint"
        inputFolder={inputFolder}
        fileCount={fileCount}
        onNavigate={(step) => {
          if (step === "select_folder" && onChangeFolder) onChangeFolder();
          else if (step === "review") onNavigateToReview();
        }}
      />

      {/* Strategy Selection Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
        <button
          onClick={() => setOrganizeMode("ai_architect")}
          className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3.5 ${
            organizeMode === "ai_architect"
              ? "bg-[#0075de]/10 dark:bg-[#0075de]/20 border-[#0075de] dark:border-[#38bdf8] shadow-sm ring-1 ring-[#0075de]/40"
              : "bg-[#ffffff] dark:bg-[#202020] border-[#e6e6e6] dark:border-[#2e2e2e] hover:border-[#0075de]/60 hover:bg-[#ffffff]"
          }`}
        >
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
              organizeMode === "ai_architect"
                ? "bg-[#0075de] text-white"
                : "bg-[#f6f5f4] dark:bg-[#282828] text-[#0075de] dark:text-[#38bdf8]"
            }`}
          >
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <h4 className="text-[13px] font-bold text-[#000000] dark:text-[#ffffff]">
                AI Organization Architect
              </h4>
              <span className="text-[9px] bg-[#0075de]/15 text-[#0075de] dark:text-[#38bdf8] px-1.5 py-0.2 rounded font-bold uppercase">
                Recommended
              </span>
            </div>
            <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
              Describe your custom structure in plain English or let AI infer smart taxonomy from your file contents.
            </p>
          </div>
        </button>

        <button
          onClick={() => setOrganizeMode("standard")}
          className={`p-4 rounded-xl border text-left transition-all cursor-pointer flex items-start gap-3.5 ${
            organizeMode === "standard"
              ? "bg-[#0075de]/10 dark:bg-[#0075de]/20 border-[#0075de] dark:border-[#38bdf8] shadow-sm ring-1 ring-[#0075de]/40"
              : "bg-[#ffffff] dark:bg-[#202020] border-[#e6e6e6] dark:border-[#2e2e2e] hover:border-[#0075de]/60 hover:bg-[#ffffff]"
          }`}
        >
          <div
            className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
              organizeMode === "standard"
                ? "bg-[#0075de] text-white"
                : "bg-[#f6f5f4] dark:bg-[#282828] text-[#615d59] dark:text-[#d4d4d4]"
            }`}
          >
            <SlidersHorizontal className="w-5 h-5" />
          </div>
          <div>
            <h4 className="text-[13px] font-bold text-[#000000] dark:text-[#ffffff] mb-1">
              Curated Standard Presets
            </h4>
            <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
              Instantly load pre-tuned 18-folder taxonomies covering Work, Finance, Development, Legal, and Media.
            </p>
          </div>
        </button>
      </div>

      {/* Active Workspace Context Bar */}
      <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-3.5 shadow-2xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-9 h-9 rounded-lg bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8] flex items-center justify-center shrink-0">
            <FolderOpen className="w-4 h-4" />
          </div>
          <div className="truncate">
            <p className="text-xs font-bold text-[#000000] dark:text-[#ffffff] flex items-center gap-1.5 truncate">
              <span>Source:</span>
              <span className="font-mono text-[#0075de] dark:text-[#38bdf8] truncate">{inputFolder || "No folder selected"}</span>
            </p>
            <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] truncate">
              Output: <span className="font-mono text-[#a39e98]">{outputFolder || `${inputFolder}/Organized_Output`}</span>
            </p>
          </div>
        </div>

        {onChangeFolder && (
          <button
            onClick={onChangeFolder}
            className="px-3 py-1.5 rounded-lg bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] border border-[#e6e6e6] dark:border-[#383838] text-[11px] font-semibold text-[#31302e] dark:text-[#d4d4d4] flex items-center gap-1.5 cursor-pointer transition shadow-2xs shrink-0"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#0075de] dark:text-[#38bdf8]" />
            <span>Change Folder</span>
          </button>
        )}
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
