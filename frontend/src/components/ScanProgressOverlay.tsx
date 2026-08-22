import React, { useEffect, useRef } from "react";
import {
  Loader2,
  CheckCircle2,
  FileSearch,
  Cpu,
  Database,
  Layers,
  Terminal,
  Sparkles,
} from "lucide-react";

interface ScanProgressOverlayProps {
  isRunning: boolean;
  currentStage: string;
  progressLogs: string[];
  inputFolder: string;
}

export const ScanProgressOverlay: React.FC<ScanProgressOverlayProps> = ({
  isRunning,
  currentStage,
  progressLogs,
  inputFolder,
}) => {
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [progressLogs]);

  if (!isRunning) return null;

  // Derive active stage from stage string or logs
  const isScanning = currentStage.toLowerCase().includes("scan") || currentStage.toLowerCase().includes("hash");
  const isExtracting = currentStage.toLowerCase().includes("extract") || currentStage.toLowerCase().includes("ocr") || currentStage.toLowerCase().includes("text");
  const isClassifying = currentStage.toLowerCase().includes("classif") || currentStage.toLowerCase().includes("llm") || currentStage.toLowerCase().includes("categor");
  const isFinalizing = currentStage.toLowerCase().includes("final") || currentStage.toLowerCase().includes("index") || currentStage.toLowerCase().includes("report");

  const stages = [
    {
      id: "scan",
      name: "Directory Scan & Deduplication",
      desc: "Hashing files and filtering duplicates",
      icon: <FileSearch className="w-4 h-4" />,
      active: isScanning,
      done: isExtracting || isClassifying || isFinalizing,
    },
    {
      id: "extract",
      name: "Text Extraction & OCR",
      desc: "Inspecting PDF, text, and image contents",
      icon: <Layers className="w-4 h-4" />,
      active: isExtracting,
      done: isClassifying || isFinalizing,
    },
    {
      id: "classify",
      name: "AI & Rule Classification",
      desc: "Mapping taxonomy rules & LLM reasoning",
      icon: <Cpu className="w-4 h-4" />,
      active: isClassifying,
      done: isFinalizing,
    },
    {
      id: "finalize",
      name: "Index & Review Preparation",
      desc: "Building local search database & staging diffs",
      icon: <Database className="w-4 h-4" />,
      active: isFinalizing,
      done: false,
    },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 dark:bg-black/80 backdrop-blur-md flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-[#ffffff] dark:bg-[#1e1e1e] border border-[#e6e6e6] dark:border-[#333333] rounded-2xl max-w-xl w-full p-6 shadow-2xl space-y-6 relative overflow-hidden">
        {/* Glowing ambient radial glow */}
        <div className="absolute -top-12 -right-12 w-48 h-48 bg-[#0075de]/20 dark:bg-[#0075de]/30 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute -bottom-12 -left-12 w-48 h-48 bg-[#9b51e0]/15 dark:bg-[#9b51e0]/25 rounded-full blur-3xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#0075de]/10 dark:bg-[#0075de]/20 text-[#0075de] dark:text-[#38bdf8] flex items-center justify-center">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#000000] dark:text-[#ffffff] flex items-center gap-2">
                <span>Analyzing Workspace</span>
                <Sparkles className="w-3.5 h-3.5 text-[#0075de]" />
              </h3>
              <p className="text-xs text-[#615d59] dark:text-[#9b9a97] font-mono truncate max-w-sm">
                {inputFolder}
              </p>
            </div>
          </div>

          <span className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8] uppercase tracking-wider animate-pulse">
            Live
          </span>
        </div>

        {/* 4 Pipeline Stages */}
        <div className="space-y-2.5">
          {stages.map((st) => (
            <div
              key={st.id}
              className={`p-3 rounded-xl border flex items-center justify-between transition-all ${
                st.active
                  ? "bg-[#0075de]/5 dark:bg-[#0075de]/15 border-[#0075de]/40 dark:border-[#38bdf8]/40 shadow-xs"
                  : st.done
                  ? "bg-[#ecf7ed]/60 dark:bg-[#0c3917]/20 border-[#1aae39]/30 text-[#166534] dark:text-[#4ade80]"
                  : "bg-[#f6f5f4]/50 dark:bg-[#252525]/50 border-[#e6e6e6]/60 dark:border-[#2e2e2e] opacity-60"
              }`}
            >
              <div className="flex items-center gap-3">
                <div
                  className={`w-7 h-7 rounded-lg flex items-center justify-center text-xs ${
                    st.active
                      ? "bg-[#0075de] text-white"
                      : st.done
                      ? "bg-[#1aae39] text-white"
                      : "bg-[#e6e6e6] dark:bg-[#333333] text-[#615d59]"
                  }`}
                >
                  {st.done ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : st.active ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    st.icon
                  )}
                </div>
                <div>
                  <p className="text-[13px] font-bold text-[#000000] dark:text-[#ffffff] leading-tight">
                    {st.name}
                  </p>
                  <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97]">
                    {st.desc}
                  </p>
                </div>
              </div>

              {st.active && (
                <span className="text-[10px] font-bold text-[#0075de] dark:text-[#38bdf8] uppercase tracking-wider">
                  In Progress
                </span>
              )}
              {st.done && (
                <span className="text-[10px] font-bold text-[#1aae39] dark:text-[#4ade80] uppercase tracking-wider">
                  Complete
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Current Activity Banner */}
        <div className="p-3 rounded-xl bg-[#f6f5f4] dark:bg-[#252525] border border-[#e6e6e6] dark:border-[#333333] flex items-center gap-2 text-xs text-[#31302e] dark:text-[#d4d4d4]">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-[#0075de] shrink-0" />
          <span className="truncate font-medium">{currentStage || "Processing files..."}</span>
        </div>

        {/* Live Terminal Log (Collapsible or compact) */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-[#a39e98] px-1 font-mono">
            <span className="flex items-center gap-1">
              <Terminal className="w-3 h-3" />
              <span>Activity Log</span>
            </span>
            <span>{progressLogs.length} events</span>
          </div>

          <div className="bg-[#121212] rounded-xl p-3 max-h-28 overflow-y-auto font-mono text-[11px] text-[#a1a1aa] space-y-1 border border-[#2a2a2a]">
            {progressLogs.map((log, idx) => (
              <p
                key={idx}
                className={`truncate ${
                  log.includes("Completed") || log.includes("Success") || log.includes("Categorized")
                    ? "text-[#4ade80]"
                    : log.includes("Error") || log.includes("Fail")
                    ? "text-[#f87171]"
                    : log.includes("Skipped")
                    ? "text-[#fbbf24]"
                    : "text-[#d4d4d8]"
                }`}
              >
                {log}
              </p>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
};
