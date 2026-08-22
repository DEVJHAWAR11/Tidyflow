import React from "react";
import { FolderOpen, Sparkles, CheckCircle2, ChevronRight, Check } from "lucide-react";

interface WorkflowStepperProps {
  currentStep: "select_folder" | "blueprint" | "review";
  inputFolder: string;
  fileCount?: number;
  onNavigate: (step: "select_folder" | "blueprint" | "review") => void;
}

export const WorkflowStepper: React.FC<WorkflowStepperProps> = ({
  currentStep,
  inputFolder,
  fileCount = 0,
  onNavigate,
}) => {
  const folderName = inputFolder ? inputFolder.replace(/^.*[\\/]/, "") || inputFolder : "";

  return (
    <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-2 shadow-2xs mb-6">
      <div className="flex items-center justify-between gap-1 sm:gap-2">
        {/* Step 1: Choose Folder */}
        <button
          onClick={() => onNavigate("select_folder")}
          className={`flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all cursor-pointer group ${
            currentStep === "select_folder"
              ? "bg-[#0075de]/10 dark:bg-[#0075de]/20 border border-[#0075de]/30 text-[#0075de] dark:text-[#38bdf8]"
              : "hover:bg-[#f6f5f4] dark:hover:bg-[#282828] text-[#615d59] dark:text-[#9b9a97]"
          }`}
        >
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
              currentStep === "select_folder"
                ? "bg-[#0075de] text-white"
                : inputFolder
                ? "bg-[#1aae39]/15 text-[#1aae39] dark:text-[#4ade80]"
                : "bg-[#e6e6e6] dark:bg-[#333333] text-[#615d59] dark:text-[#a1a1aa]"
            }`}
          >
            {inputFolder && currentStep !== "select_folder" ? (
              <Check className="w-4 h-4 stroke-[3]" />
            ) : (
              <FolderOpen className="w-3.5 h-3.5" />
            )}
          </div>
          <div className="truncate hidden sm:block">
            <p className="text-[12px] font-bold leading-tight truncate">
              1. Choose Folder
            </p>
            <p className="text-[10px] font-mono text-[#a39e98] truncate" title={inputFolder || "No folder selected"}>
              {folderName ? `📁 ${folderName}` : "Select directory..."}
            </p>
          </div>
        </button>

        <ChevronRight className="w-4 h-4 text-[#d4d2ce] dark:text-[#444444] shrink-0" />

        {/* Step 2: Blueprint & Rules */}
        <button
          onClick={() => {
            if (inputFolder) onNavigate("blueprint");
          }}
          disabled={!inputFolder}
          className={`flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all group ${
            currentStep === "blueprint"
              ? "bg-[#0075de]/10 dark:bg-[#0075de]/20 border border-[#0075de]/30 text-[#0075de] dark:text-[#38bdf8] cursor-pointer"
              : inputFolder
              ? "hover:bg-[#f6f5f4] dark:hover:bg-[#282828] text-[#615d59] dark:text-[#9b9a97] cursor-pointer"
              : "opacity-40 cursor-not-allowed text-[#a39e98]"
          }`}
        >
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
              currentStep === "blueprint"
                ? "bg-[#0075de] text-white"
                : "bg-[#e6e6e6] dark:bg-[#333333] text-[#615d59] dark:text-[#a1a1aa]"
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div className="truncate hidden sm:block">
            <p className="text-[12px] font-bold leading-tight truncate">
              2. Blueprint & Rules
            </p>
            <p className="text-[10px] text-[#a39e98] truncate">
              AI Architect & Presets
            </p>
          </div>
        </button>

        <ChevronRight className="w-4 h-4 text-[#d4d2ce] dark:text-[#444444] shrink-0" />

        {/* Step 3: Review & Apply */}
        <button
          onClick={() => {
            if (fileCount > 0) onNavigate("review");
          }}
          disabled={fileCount === 0}
          className={`flex-1 flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all group ${
            currentStep === "review"
              ? "bg-[#0075de]/10 dark:bg-[#0075de]/20 border border-[#0075de]/30 text-[#0075de] dark:text-[#38bdf8] cursor-pointer"
              : fileCount > 0
              ? "hover:bg-[#f6f5f4] dark:hover:bg-[#282828] text-[#615d59] dark:text-[#9b9a97] cursor-pointer"
              : "opacity-40 cursor-not-allowed text-[#a39e98]"
          }`}
        >
          <div
            className={`w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
              currentStep === "review"
                ? "bg-[#0075de] text-white"
                : fileCount > 0
                ? "bg-[#1aae39]/15 text-[#1aae39] dark:text-[#4ade80]"
                : "bg-[#e6e6e6] dark:bg-[#333333] text-[#615d59] dark:text-[#a1a1aa]"
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5" />
          </div>
          <div className="truncate hidden sm:block">
            <p className="text-[12px] font-bold leading-tight truncate">
              3. Review & Apply
            </p>
            <p className="text-[10px] text-[#a39e98] truncate">
              {fileCount > 0 ? `${fileCount} files scanned` : "Scan to review"}
            </p>
          </div>
        </button>
      </div>
    </div>
  );
};
