import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Loader2,
  CheckCircle2,
  FileSearch,
  Cpu,
  Database,
  Layers,
  Terminal,
  Sparkles,
  AlertTriangle,
  XCircle,
  X,
} from "lucide-react";

interface ScanProgressOverlayProps {
  isRunning: boolean;
  currentStage: string;
  progressLogs: string[];
  inputFolder: string;
  onCancel?: () => void;
  isCancelling?: boolean;
}

export const ScanProgressOverlay: React.FC<ScanProgressOverlayProps> = ({
  isRunning,
  currentStage,
  progressLogs,
  inputFolder,
  onCancel,
  isCancelling = false,
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);
  const [isConfirmingCancel, setIsConfirmingCancel] = useState(false);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progressLogs]);

  useEffect(() => {
    if (!isRunning) {
      setIsConfirmingCancel(false);
    }
  }, [isRunning]);

  if (!isRunning) return null;

  // Determine stage progression cleanly
  const stageLower = (currentStage || "").toLowerCase();
  let activeStageIndex = 0;
  if (stageLower.includes("finalize") || stageLower.includes("index") || stageLower.includes("report") || stageLower.includes("prepar")) {
    activeStageIndex = 3;
  } else if (stageLower.includes("classify") || stageLower.includes("llm") || stageLower.includes("rule") || stageLower.includes("ai")) {
    activeStageIndex = 2;
  } else if (stageLower.includes("extract") || stageLower.includes("ocr") || stageLower.includes("text")) {
    activeStageIndex = 1;
  } else {
    activeStageIndex = 0;
  }

  const stages = [
    {
      id: "scan",
      name: "Directory Scan & Deduplication",
      desc: "Hashing files and filtering duplicates",
      icon: <FileSearch className="w-4 h-4" />,
    },
    {
      id: "extract",
      name: "Text Extraction & OCR",
      desc: "Inspecting PDF, text, and image contents",
      icon: <Layers className="w-4 h-4" />,
    },
    {
      id: "classify",
      name: "AI & Rule Classification",
      desc: "Mapping taxonomy rules & LLM reasoning",
      icon: <Cpu className="w-4 h-4" />,
    },
    {
      id: "finalize",
      name: "Index & Review Preparation",
      desc: "Building local search database & staging diffs",
      icon: <Database className="w-4 h-4" />,
    },
  ];

  return createPortal(
    <div className="fixed inset-0 z-9999 bg-black/40 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#ffffff] dark:bg-[#1c1c1e] border border-[#e5e5e7] dark:border-[#2c2c2e] rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-5 relative overflow-hidden animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0075de]/10 dark:bg-[#0075de]/20 text-[#0075de] dark:text-[#38bdf8] flex items-center justify-center">
              {isCancelling ? (
                <Loader2 className="w-5 h-5 animate-spin text-[#ff3b30]" />
              ) : (
                <Loader2 className="w-5 h-5 animate-spin" />
              )}
            </div>
            <div>
              <h3 className="text-[15px] font-bold text-[#1d1d1f] dark:text-[#f5f5f7] flex items-center gap-2">
                <span>{isCancelling ? "Halting Organization..." : "Analyzing Workspace"}</span>
                {!isCancelling && <Sparkles className="w-3.5 h-3.5 text-[#0075de]" />}
              </h3>
              <p className="text-[11.5px] text-[#86868b] font-mono truncate max-w-xs">
                {inputFolder}
              </p>
            </div>
          </div>

          <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8] uppercase tracking-wider animate-pulse font-mono">
            {isCancelling ? "Cancelling" : `Step ${activeStageIndex + 1}/4`}
          </span>
        </div>

        {/* 4 Pipeline Stages */}
        <div className="space-y-2">
          {stages.map((st, idx) => {
            const isActive = idx === activeStageIndex;
            const isDone = idx < activeStageIndex;

            return (
              <div
                key={st.id}
                className={`p-3 rounded-xl border flex items-center justify-between transition-all duration-200 ${
                  isActive
                    ? "bg-[#0075de]/5 dark:bg-[#0075de]/15 border-[#0075de]/40 dark:border-[#38bdf8]/40 shadow-xs"
                    : isDone
                    ? "bg-[#ecf7ed]/60 dark:bg-[#0c3917]/20 border-[#1aae39]/30 text-[#166534] dark:text-[#4ade80]"
                    : "bg-[#f2f2f7]/50 dark:bg-[#252528]/50 border-[#e5e5e7]/60 dark:border-[#2e2e30] opacity-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${
                      isDone
                        ? "bg-[#1aae39] text-white"
                        : isActive
                        ? "bg-[#0075de] text-white"
                        : "bg-[#e5e5ea] dark:bg-[#2c2c2e] text-[#86868b]"
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="w-4 h-4" />
                    ) : isActive ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      st.icon
                    )}
                  </div>
                  <div>
                    <p className="text-[12.5px] font-semibold text-[#1d1d1f] dark:text-[#f5f5f7] leading-tight">
                      {st.name}
                    </p>
                    <p className="text-[11px] text-[#86868b]">
                      {st.desc}
                    </p>
                  </div>
                </div>

                {isActive && (
                  <span className="text-[10.5px] font-semibold text-[#0075de] dark:text-[#38bdf8] uppercase tracking-wider font-mono">
                    In Progress
                  </span>
                )}
                {isDone && (
                  <span className="text-[10.5px] font-semibold text-[#1aae39] dark:text-[#4ade80] uppercase tracking-wider font-mono">
                    Done
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Live Terminal Log */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-[#86868b] px-1 font-mono">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              <span>Activity Log</span>
            </span>
            <span>{progressLogs.length} events</span>
          </div>

          <div className="bg-[#18181b] rounded-xl p-3 max-h-28 overflow-y-auto font-mono text-[11px] text-[#a1a1aa] space-y-1 border border-[#27272a]">
            {progressLogs.length === 0 ? (
              <p className="text-[#71717a] italic">Initiating pipeline steps...</p>
            ) : (
              progressLogs.map((log, idx) => (
                <p
                  key={idx}
                  className={`truncate ${
                    log.includes("Completed") || log.includes("Success") || log.includes("Categorized") || log.includes("Done")
                      ? "text-[#4ade80]"
                      : log.includes("Error") || log.includes("Fail") || log.includes("✗") || log.includes("cancelled")
                      ? "text-[#f87171]"
                      : log.includes("Skipped")
                      ? "text-[#fbbf24]"
                      : "text-[#d4d4d8]"
                  }`}
                >
                  {log}
                </p>
              ))
            )}
            <div ref={logEndRef} />
          </div>
        </div>

        {/* Confirmation or Cancel Action Footer */}
        {isConfirmingCancel ? (
          <div className="p-3.5 rounded-xl bg-[#ff3b30]/10 border border-[#ff3b30]/30 space-y-2.5 animate-fade-in">
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 text-[#ff3b30] shrink-0 mt-0.5" />
              <div>
                <h4 className="text-[12.5px] font-bold text-[#ff3b30]">
                  Stop Organization Pipeline?
                </h4>
                <p className="text-[11px] text-[#86868b] mt-0.5 leading-snug">
                  In-progress file scans and AI requests will be halted immediately. No files will be moved or modified.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsConfirmingCancel(false)}
                disabled={isCancelling}
                className="px-3 py-1 rounded-lg text-[11.5px] font-medium bg-[#f2f2f7] dark:bg-[#2c2c2e] hover:bg-[#e5e5ea] dark:hover:bg-[#38383a] text-[#1d1d1f] dark:text-[#f5f5f7] transition cursor-pointer"
              >
                Keep Running
              </button>
              <button
                type="button"
                onClick={() => {
                  if (onCancel) onCancel();
                }}
                disabled={isCancelling}
                className="px-3 py-1 rounded-lg text-[11.5px] font-semibold bg-[#ff3b30] hover:bg-[#d70015] text-white flex items-center gap-1.5 transition cursor-pointer shadow-2xs"
              >
                {isCancelling ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>Halting...</span>
                  </>
                ) : (
                  <>
                    <XCircle className="w-3 h-3" />
                    <span>Yes, Cancel Run</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between pt-1 border-t border-[#e5e5e7] dark:border-[#2c2c2e]">
            <span className="text-[11px] text-[#86868b] font-mono">
              Safe & non-destructive scan
            </span>
            {onCancel && (
              <button
                type="button"
                onClick={() => setIsConfirmingCancel(true)}
                disabled={isCancelling}
                className="px-2.5 py-1 rounded-lg text-[11.5px] font-medium text-[#86868b] hover:text-[#ff3b30] hover:bg-[#ff3b30]/10 transition flex items-center gap-1 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
                <span>Cancel Run</span>
              </button>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
};
