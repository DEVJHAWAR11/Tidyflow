import React, { useState, useEffect } from "react";
import { WorkflowStepper } from "./WorkflowStepper";
import { API_BASE } from "../config";
import {
  FolderOpen,
  FolderDown,
  Download,
  Monitor,
  FileText,
  Image,
  Home,
  HardDrive,
  Sparkles,
  ArrowRight,
  ArrowLeft,
  Compass,
  Check,
  Edit2,
  Folder,
} from "lucide-react";

interface QuickLocation {
  name: string;
  path: string;
  icon?: string;
}

interface FolderSelectViewProps {
  inputFolder: string;
  setInputFolder: (path: string) => void;
  outputFolder: string;
  setOutputFolder: (path: string) => void;
  onContinue: () => void;
  onBack: () => void;
  onOpenDirectoryPicker: (target: "source" | "destination") => void;
  fileCount?: number;
  onNavigateToReview?: () => void;
}

const isMac = typeof navigator !== "undefined" && /(Mac|iPhone|iPod|iPad)/i.test(navigator.userAgent);

export const FolderSelectView: React.FC<FolderSelectViewProps> = ({
  inputFolder,
  setInputFolder,
  outputFolder,
  setOutputFolder,
  onContinue,
  onBack,
  onOpenDirectoryPicker,
  fileCount = 0,
  onNavigateToReview,
}) => {
  const [quickLocations, setQuickLocations] = useState<QuickLocation[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [showManualInput, setShowManualInput] = useState(false);
  const [manualPath, setManualPath] = useState(inputFolder);
  const [isNativeBrowsing, setIsNativeBrowsing] = useState(false);
  const [isEditingDestination, setIsEditingDestination] = useState(false);

  // Fetch quick system locations
  useEffect(() => {
    fetch(`${API_BASE}/fs/quick-locations`)
      .then((res) => res.json())
      .then((data) => {
        if (data.locations) {
          setQuickLocations(data.locations);
        }
      })
      .catch((err) => console.error("Failed to load quick locations:", err));
  }, []);

  const handleSelectSource = (path: string) => {
    setInputFolder(path);
    setManualPath(path);
    if (!outputFolder || outputFolder.endsWith("/Organized_Output") || !outputFolder.trim()) {
      setOutputFolder(`${path}/Organized_Output`);
    }
  };

  const handleNativeBrowse = async (target: "source" | "destination" = "source") => {
    setIsNativeBrowsing(true);
    try {
      const res = await fetch(`${API_BASE}/fs/browse-native`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: target === "source" ? "Select Messy Folder to Organize" : "Select Destination Folder",
          initial_dir: target === "source" ? inputFolder : outputFolder,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.path && !data.cancelled) {
          if (target === "source") {
            handleSelectSource(data.path);
          } else {
            setOutputFolder(data.path);
          }
        }
      }
    } catch (err) {
      console.error("Native browse failed, falling back to in-app picker:", err);
      onOpenDirectoryPicker(target);
    } finally {
      setIsNativeBrowsing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      const fullPath = (file as any).path;
      if (fullPath) {
        handleSelectSource(fullPath);
        return;
      }
    }

    const textData = e.dataTransfer.getData("text/plain");
    if (textData && (textData.startsWith("/") || textData.startsWith("C:\\") || textData.startsWith("~"))) {
      handleSelectSource(textData.trim());
      return;
    }

    onOpenDirectoryPicker("source");
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualPath.trim()) {
      handleSelectSource(manualPath.trim());
      setShowManualInput(false);
    }
  };

  const getLocationIcon = (name: string) => {
    switch (name.toLowerCase()) {
      case "downloads":
        return <Download className="w-5 h-5 text-[#0075de] dark:text-[#38bdf8]" />;
      case "desktop":
        return <Monitor className="w-5 h-5 text-[#9b51e0] dark:text-[#c084fc]" />;
      case "documents":
        return <FileText className="w-5 h-5 text-[#1aae39] dark:text-[#4ade80]" />;
      case "pictures":
        return <Image className="w-5 h-5 text-[#ff64c8] dark:text-[#f472b6]" />;
      case "home":
        return <Home className="w-5 h-5 text-[#dd5b00] dark:text-[#fb923c]" />;
      default:
        return <HardDrive className="w-5 h-5 text-[#615d59] dark:text-[#9b9a97]" />;
    }
  };

  const isReady = Boolean(inputFolder && inputFolder.trim());

  return (
    <div className="max-w-4xl mx-auto py-6 px-4 sm:px-6 space-y-6 animate-fade-in">
      {/* Interactive Workflow Stepper */}
      <WorkflowStepper
        currentStep="select_folder"
        inputFolder={inputFolder}
        fileCount={fileCount}
        onNavigate={(step) => {
          if (step === "blueprint" && inputFolder) onContinue();
          else if (step === "review" && fileCount > 0 && onNavigateToReview) onNavigateToReview();
        }}
      />

      {/* Back button */}
      <div className="flex items-center justify-start -mt-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#615d59] dark:text-[#a1a1aa] hover:text-[#0075de] dark:hover:text-[#38bdf8] transition cursor-pointer px-2.5 py-1 rounded-lg hover:bg-[#ffffff] dark:hover:bg-[#252525]"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Welcome</span>
        </button>
      </div>

      {/* Header Title */}
      <div>
        <h2 className="text-2xl sm:text-3xl font-extrabold text-[#000000] dark:text-[#ffffff] tracking-tight mb-1.5">
          Select Folder to Organize
        </h2>
        <p className="text-[13px] sm:text-[14px] text-[#615d59] dark:text-[#9b9a97]">
          Drag and drop your messy folder below or select one of your system bookmarks.
        </p>
      </div>

      {/* Hero Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragEnter={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => handleNativeBrowse("source")}
        className={`relative rounded-2xl border-2 border-dashed p-8 sm:p-10 text-center transition-all cursor-pointer group ${
          isDragging
            ? "border-[#0075de] dark:border-[#38bdf8] bg-[#0075de]/10 dark:bg-[#0075de]/20 scale-[1.01] shadow-[0_0_30px_rgba(0,117,222,0.25)]"
            : inputFolder
            ? "border-[#0075de]/40 dark:border-[#38bdf8]/40 bg-[#ffffff] dark:bg-[#202020] shadow-[0_4px_20px_rgba(0,0,0,0.03)]"
            : "border-[#d6d5d2] dark:border-[#383838] bg-[#ffffff]/80 dark:bg-[#202020]/80 hover:border-[#0075de]/70 dark:hover:border-[#38bdf8]/70 hover:bg-[#ffffff] dark:hover:bg-[#242424]"
        }`}
      >
        <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-b from-[#0075de]/10 to-[#9b51e0]/10 dark:from-[#0075de]/20 dark:to-[#9b51e0]/20 flex items-center justify-center text-[#0075de] dark:text-[#38bdf8] group-hover:scale-110 transition-transform duration-300 shadow-inner">
          <FolderOpen className="w-8 h-8 sm:w-10 sm:h-10" />
        </div>

        {inputFolder ? (
          <div>
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-[#1aae39]/10 text-[#1aae39] dark:text-[#4ade80] text-[11px] font-bold uppercase mb-2">
              <Check className="w-3 h-3" /> Selected
            </span>
            <h3 className="text-lg font-bold text-[#000000] dark:text-[#ffffff] font-mono mb-1 truncate max-w-lg mx-auto">
              {inputFolder}
            </h3>
            <p className="text-xs text-[#615d59] dark:text-[#9b9a97] mb-4">
              Click anywhere to choose a different folder
            </p>
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-bold text-[#000000] dark:text-[#ffffff] mb-1">
              {isDragging ? "Drop folder here!" : "Drag & drop messy folder here"}
            </h3>
            <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97] mb-4">
              Supports Downloads, Desktop, Documents, or any custom project directory.
            </p>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              handleNativeBrowse("source");
            }}
            disabled={isNativeBrowsing}
            className="px-5 py-2 rounded-xl bg-[#0075de] hover:bg-[#005bab] dark:bg-[#2383e2] dark:hover:bg-[#1a73e8] text-white font-semibold text-[13px] shadow-sm flex items-center gap-2 cursor-pointer transition active:scale-95"
          >
            <FolderOpen className="w-4 h-4" />
            <span>{isNativeBrowsing ? "Opening Dialog..." : (isMac ? "Choose with Finder..." : "Choose with Explorer...")}</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onOpenDirectoryPicker("source");
            }}
            className="px-4 py-2 rounded-xl bg-[#f6f5f4] dark:bg-[#2c2c2c] hover:bg-[#eae8e5] dark:hover:bg-[#383838] border border-[#e6e6e6] dark:border-[#3a3a3a] text-[#31302e] dark:text-[#e4e4e7] font-semibold text-[13px] flex items-center gap-1.5 cursor-pointer transition"
          >
            <Compass className="w-4 h-4 text-[#615d59] dark:text-[#a1a1aa]" />
            <span>In-App Browser</span>
          </button>
        </div>

        {/* Manual path toggle */}
        <div className="mt-4 pt-3 border-t border-[#e6e6e6]/60 dark:border-[#2e2e2e]">
          {!showManualInput ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setShowManualInput(true);
              }}
              className="text-[11px] text-[#0075de] dark:text-[#38bdf8] hover:underline font-medium cursor-pointer"
            >
              Or type/paste path directly
            </button>
          ) : (
            <form
              onSubmit={(e) => {
                e.stopPropagation();
                handleManualSubmit(e);
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex items-center gap-2 max-w-md mx-auto mt-2"
            >
              <input
                type="text"
                value={manualPath}
                onChange={(e) => setManualPath(e.target.value)}
                placeholder="/Users/username/Downloads"
                className="flex-1 bg-[#ffffff] dark:bg-[#181818] border border-[#e6e6e6] dark:border-[#383838] rounded-lg px-3 py-1.5 text-xs font-mono text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de]"
                autoFocus
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-[#0075de] text-white rounded-lg text-xs font-semibold hover:bg-[#005bab] cursor-pointer"
              >
                Set
              </button>
              <button
                type="button"
                onClick={() => setShowManualInput(false)}
                className="px-2 py-1.5 text-xs text-[#a39e98] hover:text-[#000000] dark:hover:text-[#ffffff]"
              >
                Cancel
              </button>
            </form>
          )}
        </div>
      </div>

      {/* Quick Launch Bookmarks */}
      {quickLocations.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#615d59] dark:text-[#a1a1aa] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#0075de] dark:text-[#38bdf8]" />
              <span>System Bookmarks</span>
            </h4>
            <span className="text-[11px] text-[#a39e98]">Click to instantly select</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {quickLocations.map((loc) => {
              const isSelected = inputFolder === loc.path;
              return (
                <button
                  key={loc.path}
                  onClick={() => handleSelectSource(loc.path)}
                  className={`group p-3.5 rounded-xl border transition-all text-left flex items-center justify-between cursor-pointer hover:-translate-y-0.5 ${
                    isSelected
                      ? "bg-[#0075de]/10 dark:bg-[#0075de]/20 border-[#0075de] dark:border-[#38bdf8] shadow-[0_2px_12px_rgba(0,117,222,0.2)]"
                      : "bg-[#ffffff] dark:bg-[#202020] border-[#e6e6e6] dark:border-[#2e2e2e] hover:border-[#0075de] dark:hover:border-[#38bdf8] hover:shadow-sm"
                  }`}
                >
                  <div className="flex items-center gap-3 overflow-hidden">
                    <div
                      className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? "bg-[#0075de] text-white"
                          : "bg-[#f6f5f4] dark:bg-[#282828] group-hover:bg-[#0075de]/10"
                      }`}
                    >
                      {getLocationIcon(loc.name)}
                    </div>
                    <div className="truncate">
                      <p className="text-[13px] font-bold text-[#000000] dark:text-[#ffffff] truncate">
                        {loc.name}
                      </p>
                      <p className="text-[10px] font-mono text-[#a39e98] truncate" title={loc.path}>
                        {loc.path.replace(/^.*[\\/]/, "") || loc.path}
                      </p>
                    </div>
                  </div>
                  {isSelected ? (
                    <Check className="w-4 h-4 text-[#0075de] dark:text-[#38bdf8] shrink-0 ml-1" />
                  ) : (
                    <ArrowRight className="w-4 h-4 text-[#a39e98] group-hover:text-[#0075de] group-hover:translate-x-0.5 transition-all shrink-0 ml-1" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Destination Directory & Output Path Bar */}
      <div className="p-4 rounded-xl bg-[#ffffff] dark:bg-[#202020] border border-[#e6e6e6] dark:border-[#2e2e2e] shadow-2xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#9b51e0]/10 text-[#9b51e0] dark:text-[#d8b4fe] flex items-center justify-center shrink-0">
              <FolderDown className="w-5 h-5" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#000000] dark:text-[#ffffff] flex items-center gap-1.5">
                <span>Destination Folder:</span>
                <span className="text-[10px] uppercase font-bold text-[#a39e98] bg-[#f6f5f4] dark:bg-[#282828] px-1.5 py-0.2 rounded">
                  Safe Copy
                </span>
              </p>
              {!isEditingDestination ? (
                <p className="text-xs font-mono text-[#615d59] dark:text-[#9b9a97] truncate max-w-md">
                  {outputFolder || `${inputFolder}/Organized_Output`}
                </p>
              ) : (
                <div className="flex items-center gap-2 mt-1">
                  <input
                    type="text"
                    value={outputFolder}
                    onChange={(e) => setOutputFolder(e.target.value)}
                    className="bg-[#ffffff] dark:bg-[#181818] border border-[#e6e6e6] dark:border-[#383838] rounded-md px-2.5 py-1 text-xs font-mono text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de]"
                  />
                  <button
                    onClick={() => setIsEditingDestination(false)}
                    className="px-2 py-1 bg-[#0075de] text-white rounded text-[11px] font-semibold"
                  >
                    Done
                  </button>
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {!isEditingDestination && (
              <button
                type="button"
                onClick={() => setIsEditingDestination(true)}
                className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#615d59] dark:text-[#9b9a97] hover:text-[#000000] dark:hover:text-[#ffffff] hover:bg-[#f6f5f4] dark:hover:bg-[#2a2a2a] border border-[#e6e6e6] dark:border-[#383838] flex items-center gap-1 cursor-pointer"
              >
                <Edit2 className="w-3 h-3" />
                <span>Edit Path</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => handleNativeBrowse("destination")}
              className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold text-[#31302e] dark:text-[#d4d4d4] hover:bg-[#f6f5f4] dark:hover:bg-[#2a2a2a] border border-[#e6e6e6] dark:border-[#383838] flex items-center gap-1 cursor-pointer"
            >
              <Folder className="w-3.5 h-3.5 text-[#9b51e0]" />
              <span>Browse...</span>
            </button>
          </div>
        </div>
      </div>

      {/* Sticky Bottom Action Bar */}
      <div className="flex items-center justify-between pt-2 border-t border-[#e6e6e6]/80 dark:border-[#2e2e2e]">
        <button
          onClick={onBack}
          className="px-4 py-2.5 rounded-xl text-xs font-semibold text-[#615d59] dark:text-[#a1a1aa] hover:text-[#000000] dark:hover:text-[#ffffff] cursor-pointer"
        >
          Cancel
        </button>

        <button
          onClick={onContinue}
          disabled={!isReady}
          className={`px-6 py-2.5 rounded-xl font-bold text-[13px] flex items-center gap-2 shadow-sm transition-all cursor-pointer ${
            isReady
              ? "bg-[#0075de] hover:bg-[#005bab] dark:bg-[#2383e2] text-white shadow-[0_4px_14px_rgba(0,117,222,0.3)] active:scale-97"
              : "bg-[#e6e6e6] dark:bg-[#333333] text-[#a39e98] cursor-not-allowed"
          }`}
        >
          <span>Continue to Organization Blueprint</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
