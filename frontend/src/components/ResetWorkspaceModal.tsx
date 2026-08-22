import React from "react";
import { RotateCcw, X } from "lucide-react";

interface ResetWorkspaceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  inputFolder?: string;
  categoryCount?: number;
  fileCount?: number;
}

export const ResetWorkspaceModal: React.FC<ResetWorkspaceModalProps> = ({
  isOpen,
  onClose,
  onConfirm,
  inputFolder,
  categoryCount = 0,
  fileCount = 0,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs animate-fade-in">
      <div className="bg-[#ffffff] dark:bg-[#1c1c1e] rounded-2xl border border-[#e5e5e7] dark:border-[#2c2c2e] shadow-xl max-w-md w-full p-6 space-y-5 animate-scale-in">
        {/* Modal Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#ff3b30]/10 text-[#ff3b30] flex items-center justify-center shrink-0">
              <RotateCcw className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#1d1d1f] dark:text-[#f5f5f7]">
                Clear Workspace & Start Fresh?
              </h3>
              <p className="text-[12px] text-[#86868b]">
                Reset your session and choose a new directory.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[#86868b] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] hover:bg-[#f2f2f7] dark:hover:bg-[#2c2c2e] transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body Context */}
        <div className="p-3.5 rounded-xl bg-[#f2f2f7]/70 dark:bg-[#242426] border border-[#e5e5e7] dark:border-[#2c2c2e] space-y-2 text-[12.5px] text-[#48484a] dark:text-[#d1d1d6]">
          <p className="leading-relaxed">
            This will reset your current folder selection, category blueprint, and unapplied review decisions.
          </p>
          {(inputFolder || categoryCount > 0 || fileCount > 0) && (
            <div className="pt-2 border-t border-[#e5e5e7] dark:border-[#2c2c2e] font-mono text-[11.5px] text-[#86868b] space-y-1">
              {inputFolder && (
                <div className="truncate">
                  <span className="font-semibold text-[#1d1d1f] dark:text-[#f5f5f7]">Active: </span>
                  <span className="text-[#0075de] dark:text-[#38bdf8] truncate">{inputFolder}</span>
                </div>
              )}
              <div className="flex gap-3">
                {categoryCount > 0 && <span>{categoryCount} categories</span>}
                {fileCount > 0 && <span>{fileCount} scanned files</span>}
              </div>
            </div>
          )}
          <div className="flex items-center gap-1.5 text-[11.5px] text-[#34c759] pt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34c759]" />
            <span>Your original files on disk will NOT be deleted or modified.</span>
          </div>
        </div>

        {/* Modal Actions */}
        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-[13px] font-medium text-[#6e6e73] dark:text-[#98989d] hover:bg-[#f2f2f7] dark:hover:bg-[#2c2c2e] hover:text-[#1d1d1f] dark:hover:text-[#f5f5f7] transition cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onConfirm();
              onClose();
            }}
            className="px-4 py-2 rounded-xl bg-[#ff3b30] hover:bg-[#e02e24] text-white text-[13px] font-semibold flex items-center gap-1.5 transition shadow-xs cursor-pointer active:scale-[0.98]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset Workspace</span>
          </button>
        </div>
      </div>
    </div>
  );
};
