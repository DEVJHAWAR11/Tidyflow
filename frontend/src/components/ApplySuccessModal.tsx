import React from "react";
import { createPortal } from "react-dom";
import {
  CheckCircle2,
  FolderOpen,
  Search,
  RotateCcw,
  Sparkles,
  ShieldCheck,
  FolderDown,
  X,
} from "lucide-react";

interface ApplySuccessModalProps {
  isOpen: boolean;
  onClose: () => void;
  count: number;
  action: string;
  outputDir: string;
  onOpenFolder: (path: string) => void;
  onNavigateToSearch: () => void;
  onOrganizeAnother: () => void;
}

export const ApplySuccessModal: React.FC<ApplySuccessModalProps> = ({
  isOpen,
  onClose,
  count,
  action,
  outputDir,
  onOpenFolder,
  onNavigateToSearch,
  onOrganizeAnother,
}) => {
  if (!isOpen) return null;

  const isCopy = action === "copy_to_organized";

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] bg-black/50 dark:bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-[#ffffff] dark:bg-[#1e1e1e] border border-[#e6e6e6] dark:border-[#333333] rounded-3xl max-w-lg w-full p-6 sm:p-8 shadow-2xl space-y-6 relative overflow-hidden text-center">
        {/* Ambient celebration glow */}
        <div className="absolute -top-16 left-1/2 -translate-x-1/2 w-64 h-64 bg-gradient-to-b from-[#1aae39]/25 to-transparent rounded-full blur-3xl pointer-events-none" />

        {/* Close icon button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-full text-[#a39e98] hover:text-[#000000] dark:hover:text-[#ffffff] hover:bg-[#f6f5f4] dark:hover:bg-[#282828] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Success Icon */}
        <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto rounded-3xl bg-[#1aae39]/10 text-[#1aae39] dark:text-[#4ade80] flex items-center justify-center shadow-inner border border-[#1aae39]/20">
          <CheckCircle2 className="w-9 h-9 sm:w-11 sm:h-11" />
        </div>

        {/* Title & Subtitle */}
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-0.5 rounded-full bg-[#1aae39]/10 text-[#1aae39] dark:text-[#4ade80] text-[11px] font-bold uppercase mb-2">
            <Sparkles className="w-3 h-3" />
            <span>Success</span>
          </div>

          <h3 className="text-2xl font-extrabold text-[#000000] dark:text-[#ffffff] tracking-tight">
            Workspace Organized!
          </h3>

          <p className="text-[13px] sm:text-[14px] text-[#615d59] dark:text-[#9b9a97] mt-1.5 max-w-sm mx-auto">
            Successfully filed <span className="font-bold text-[#000000] dark:text-[#ffffff]">{count} documents</span> into categorized subfolders.
          </p>
        </div>

        {/* Output Location Card */}
        <div className="p-4 rounded-2xl bg-[#f6f5f4] dark:bg-[#252525] border border-[#e6e6e6] dark:border-[#333333] text-left space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-[#a39e98] uppercase font-bold tracking-wider">
            <span className="flex items-center gap-1">
              <FolderDown className="w-3.5 h-3.5 text-[#9b51e0]" />
              <span>Destination Folder</span>
            </span>
            <span className="text-[#1aae39]">{isCopy ? "Safe Copy" : "Moved In-Place"}</span>
          </div>
          <p className="text-xs font-mono text-[#000000] dark:text-[#ffffff] truncate" title={outputDir}>
            {outputDir}
          </p>
        </div>

        {/* Action Buttons Grid */}
        <div className="space-y-2.5">
          <button
            onClick={() => onOpenFolder(outputDir)}
            className="w-full py-3 rounded-xl bg-[#0075de] hover:bg-[#005bab] dark:bg-[#2383e2] dark:hover:bg-[#1a73e8] text-white font-bold text-sm shadow-[0_4px_14px_rgba(0,117,222,0.3)] flex items-center justify-center gap-2 cursor-pointer transition active:scale-98"
          >
            <FolderOpen className="w-4 h-4" />
            <span>Open in Finder / Explorer</span>
          </button>

          <div className="grid grid-cols-2 gap-2.5">
            <button
              onClick={onNavigateToSearch}
              className="py-2.5 rounded-xl bg-[#ffffff] dark:bg-[#282828] hover:bg-[#f6f5f4] dark:hover:bg-[#333333] border border-[#e6e6e6] dark:border-[#383838] text-[#31302e] dark:text-[#e4e4e7] font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
            >
              <Search className="w-3.5 h-3.5 text-[#0075de]" />
              <span>Search Index</span>
            </button>

            <button
              onClick={onOrganizeAnother}
              className="py-2.5 rounded-xl bg-[#ffffff] dark:bg-[#282828] hover:bg-[#f6f5f4] dark:hover:bg-[#333333] border border-[#e6e6e6] dark:border-[#383838] text-[#31302e] dark:text-[#e4e4e7] font-semibold text-xs flex items-center justify-center gap-1.5 cursor-pointer transition"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#1aae39]" />
              <span>New Folder</span>
            </button>
          </div>
        </div>

        {/* Safety Note */}
        <p className="text-[11px] text-[#a39e98] flex items-center justify-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-[#1aae39]" />
          <span>Full audit report generated at {outputDir}/audit_report.json</span>
        </p>
      </div>
    </div>,
    document.body
  );
};
