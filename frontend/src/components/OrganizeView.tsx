import React from "react";
import { CategoryItem, RunSummary } from "../types";
import { AiStructureAssistant } from "./AiStructureAssistant";
import { WorkflowStepper } from "./WorkflowStepper";
import { ScanProgressOverlay } from "./ScanProgressOverlay";
import {
  FolderOpen,
  ArrowRight,
  Terminal,
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
  onStartPipeline: (customCats?: Record<string, CategoryItem>, instructions?: string, complexity?: any) => void;
  onNavigateToReview: () => void;
  onNavigateToCategories: () => void;
  onChangeFolder?: () => void;
  fileCount?: number;
  complexityLevel?: any;
  setComplexityLevel?: (lvl: any) => void;
  onCancelPipeline?: () => void;
  isCancelling?: boolean;
}

export const OrganizeView: React.FC<OrganizeViewProps> = ({
  inputFolder,
  outputFolder,
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
  onChangeFolder,
  fileCount = 0,
  complexityLevel = "medium",
  setComplexityLevel,
  onCancelPipeline,
  isCancelling = false,
}) => {
  return (
    <div className="space-y-5 animate-fade-in max-w-6xl mx-auto">
      {/* Live Scan & AI Analysis Progress Overlay */}
      <ScanProgressOverlay
        isRunning={isRunning}
        currentStage={currentStage}
        progressLogs={progressLogs}
        inputFolder={inputFolder}
        onCancel={onCancelPipeline}
        isCancelling={isCancelling}
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

      {/* Active Workspace Source Folder Bar */}
      <div className="bg-[#ffffff] dark:bg-[#1c1c1e] rounded-xl border border-[#e5e5e7] dark:border-[#2c2c2e] px-4 py-3 shadow-xs flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-[#0075de]/10 dark:bg-[#0075de]/20 text-[#0075de] dark:text-[#38bdf8] flex items-center justify-center shrink-0">
            <FolderOpen className="w-4 h-4" />
          </div>
          <div className="truncate">
            <div className="text-[13px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5 truncate">
              <span>Source Directory:</span>
              <span className="font-mono text-[#0075de] dark:text-[#38bdf8] truncate font-medium">
                {inputFolder || "No folder selected"}
              </span>
            </div>
            <p className="text-[11px] text-[#86868b] dark:text-[#86868b] truncate">
              Target Output: <span className="font-mono">{outputFolder || `${inputFolder}/Organized_Output`}</span>
            </p>
          </div>
        </div>

        {onChangeFolder && (
          <button
            onClick={onChangeFolder}
            className="px-3 py-1.5 rounded-lg bg-[#f2f2f7] dark:bg-[#2c2c2e] hover:bg-[#e5e5ea] dark:hover:bg-[#38383a] border border-[#e5e5e7] dark:border-[#38383a] text-[11.5px] font-medium text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-1.5 cursor-pointer transition shadow-2xs shrink-0"
          >
            <FolderOpen className="w-3.5 h-3.5 text-[#0075de] dark:text-[#38bdf8]" />
            <span>Change Directory</span>
          </button>
        )}
      </div>

      {/* Main Workspace: Taxonomy Blueprint Studio */}
      <AiStructureAssistant
        inputFolder={inputFolder}
        activeCategories={categories}
        setActiveCategories={setCategories}
        customInstructions={customInstructions}
        setCustomInstructions={setCustomInstructions}
        onApproveAndOrganize={() => onStartPipeline(categories, customInstructions, complexityLevel)}
        isRunning={isRunning}
        backendStatus={backendStatus}
        complexityLevel={complexityLevel}
        setComplexityLevel={setComplexityLevel}
      />

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
