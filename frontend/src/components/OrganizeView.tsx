import React from "react";
import { CategoryItem, RunSummary } from "../types";
import { getStickerStyle } from "../utils/stickerTheme";
import {
  FolderOpen,
  FolderDown,
  FileSearch,
  ArrowRight,
  ShieldCheck,
  Terminal,
  Layers,
  ChevronRight,
  Loader2,
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
  summary: RunSummary | null;
  backendStatus: string;
  onStartPipeline: () => void;
  onNavigateToReview: () => void;
  onNavigateToCategories: () => void;
}

const PRESET_FOLDERS = [
  "/Users/arpan/test files",
  "/Users/arpan/Downloads",
  "/Users/arpan/Documents",
  "/Users/arpan/Desktop",
];

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
  summary,
  backendStatus,
  onStartPipeline,
  onNavigateToReview,
  onNavigateToCategories,
}) => {
  const activeCategoryCount = Object.values(categories).filter((c) => c.active).length;

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
      {/* Header */}
      <div className="border-b border-[#e6e6e6] dark:border-[#2e2e2e] pb-4">
        <div className="flex items-center gap-2 text-[13px] text-[#615d59] dark:text-[#9b9a97] mb-1 font-medium">
          <span>Workspace</span>
          <ChevronRight className="w-3.5 h-3.5" />
          <span className="text-[#000000] dark:text-[#ffffff]">Pipeline Runner</span>
        </div>
        <h2 className="text-3xl font-bold text-[#000000] dark:text-[#ffffff] tracking-heading-1">
          Organize Folders
        </h2>
        <p className="text-[15px] text-[#615d59] dark:text-[#9b9a97] mt-1">
          Scan any directory to extract text, run OCR on images and PDFs, find duplicates, and organize files into category folders.
        </p>
      </div>

      {/* Main 2-Column Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Directory Configuration (2 cols) */}
        <div className="lg:col-span-2 space-y-5">
          {/* Main Configuration Card */}
          <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] space-y-6">
            {/* Input Directory Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[14px] font-semibold text-[#000000] dark:text-[#ffffff] flex items-center gap-2">
                  <FolderOpen className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
                  <span>Input Source Directory</span>
                </label>
                <span className="text-[11px] text-[#a39e98] uppercase tracking-eyebrow font-semibold">
                  Required
                </span>
              </div>
              <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97] mb-2.5">
                The folder containing files to scan and organize.
              </p>
              <input
                type="text"
                value={inputFolder}
                onChange={(e) => setInputFolder(e.target.value)}
                placeholder="/Users/username/Downloads"
                className="w-full bg-[#ffffff] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3.5 py-2.5 text-[13px] font-mono text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:ring-2 focus:ring-[#0075de]/15 shadow-sm transition"
              />

              {/* Quick Preset Badges */}
              <div className="flex flex-wrap items-center gap-1.5 mt-3">
                <span className="text-[12px] text-[#615d59] dark:text-[#9b9a97] font-medium mr-1">Presets:</span>
                {PRESET_FOLDERS.map((preset) => {
                  const isSelected = inputFolder === preset;
                  const folderName = preset.split("/").pop();
                  return (
                    <button
                      key={preset}
                      onClick={() => {
                        setInputFolder(preset);
                        setOutputFolder(`${preset}/Organized_Output`);
                      }}
                      className={`text-[12px] px-2.5 py-1 rounded-md font-mono border transition-all cursor-pointer ${
                        isSelected
                          ? "bg-[#0075de] dark:bg-[#2383e2] text-white border-[#0075de] dark:border-[#2383e2] font-semibold shadow-xs"
                          : "bg-[#f6f5f4] dark:bg-[#282828] text-[#31302e] dark:text-[#d4d4d4] border-[#e6e6e6] dark:border-[#383838] hover:bg-[#eae8e5] dark:hover:bg-[#333333]"
                      }`}
                    >
                      {folderName}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="border-t border-[#e6e6e6] dark:border-[#2e2e2e]" />

            {/* Output Directory Section */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[14px] font-semibold text-[#000000] dark:text-[#ffffff] flex items-center gap-2">
                  <FolderDown className="w-4 h-4 text-[#9b51e0] dark:text-[#d8b4fe]" />
                  <span>Destination Output Directory</span>
                </label>
                <span className="text-[11px] text-[#a39e98] uppercase tracking-eyebrow font-semibold">
                  Auto-Created
                </span>
              </div>
              <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97] mb-2.5">
                Organized category folders will be placed here.
              </p>
              <input
                type="text"
                value={outputFolder}
                onChange={(e) => setOutputFolder(e.target.value)}
                placeholder="/Users/username/Organized_Output"
                className="w-full bg-[#ffffff] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3.5 py-2.5 text-[13px] font-mono text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:ring-2 focus:ring-[#0075de]/15 shadow-sm transition"
              />
            </div>

            <div className="border-t border-[#e6e6e6] dark:border-[#2e2e2e]" />

            {/* Options and Action Button */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
              {/* Deep Content Inspection Toggle */}
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
                    Analyzes document contents when rule matching is uncertain.
                  </p>
                </div>
              </label>

              {/* Primary Action Button */}
              <button
                onClick={onStartPipeline}
                disabled={isRunning || backendStatus !== "running" || !inputFolder.trim()}
                className={`px-6 py-2.5 rounded-full font-semibold text-[14px] flex items-center gap-2 shadow-sm transition-all cursor-pointer ${
                  isRunning || backendStatus !== "running" || !inputFolder.trim()
                    ? "bg-[#e6e6e6] dark:bg-[#333333] text-[#a39e98] cursor-not-allowed"
                    : "bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] dark:hover:bg-[#1d70c2] text-white active:scale-97 shadow-[0_2px_4px_rgba(0,117,222,0.25)]"
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

        {/* Right Column: Taxonomy Preview & Safety Callout */}
        <div className="space-y-5">
          {/* Active Taxonomy Card */}
          <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[14px] font-semibold text-[#000000] dark:text-[#ffffff] flex items-center gap-1.5">
                <Layers className="w-4 h-4 text-[#615d59] dark:text-[#9b9a97]" />
                <span>Active Categories</span>
              </h3>
              <button
                onClick={onNavigateToCategories}
                className="text-[12px] font-medium text-[#0075de] dark:text-[#2383e2] hover:underline cursor-pointer"
              >
                Manage ({activeCategoryCount})
              </button>
            </div>
            <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] mb-3">
              Files are matched against these configured categories:
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
