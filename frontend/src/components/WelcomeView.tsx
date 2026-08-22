import React, { useState, useEffect } from "react";
import logoImg from "../assets/logo.png";
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
  ShieldCheck,
  Search,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  Compass,
} from "lucide-react";

interface QuickLocation {
  name: string;
  path: string;
  icon?: string;
}

interface WelcomeViewProps {
  onSelectFolder: (path: string) => void;
  onOpenDirectoryPicker: () => void;
  recentFolder?: string;
  recentSummary?: { total_scanned?: number; text_extracted?: number } | null;
  outputFolder?: string;
  onOpenOutputFolder?: (path: string) => void;
}

export const WelcomeView: React.FC<WelcomeViewProps> = ({
  onSelectFolder,
  onOpenDirectoryPicker,
  recentFolder,
  recentSummary,
  outputFolder,
  onOpenOutputFolder,
}) => {
  const [quickLocations, setQuickLocations] = useState<QuickLocation[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [manualPath, setManualPath] = useState("");
  const [showManualInput, setShowManualInput] = useState(false);
  const [isNativeBrowsing, setIsNativeBrowsing] = useState(false);
  
  // Animation state: check if intro animation has been played in this session
  const [hasPlayedIntro, setHasPlayedIntro] = useState<boolean>(() => {
    return sessionStorage.getItem("tidyflow_intro_played") === "true";
  });
  const [isFlying, setIsFlying] = useState(!hasPlayedIntro);

  useEffect(() => {
    if (!hasPlayedIntro) {
      const timer = setTimeout(() => {
        setIsFlying(false);
        setHasPlayedIntro(true);
        sessionStorage.setItem("tidyflow_intro_played", "true");
      }, 1300);
      return () => clearTimeout(timer);
    }
  }, [hasPlayedIntro]);

  const handleReplayIntro = () => {
    setIsFlying(true);
    setHasPlayedIntro(false);
    sessionStorage.removeItem("tidyflow_intro_played");
    setTimeout(() => {
      setIsFlying(false);
      setHasPlayedIntro(true);
      sessionStorage.setItem("tidyflow_intro_played", "true");
    }, 1300);
  };

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

  const handleNativeBrowse = async () => {
    setIsNativeBrowsing(true);
    try {
      const res = await fetch(`${API_BASE}/fs/browse-native`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: "Select Messy Folder to Organize" }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.path && !data.cancelled) {
          onSelectFolder(data.path);
        }
      }
    } catch (err) {
      console.error("Native browse failed, falling back to in-app picker:", err);
      onOpenDirectoryPicker();
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

    // If browser provides dropped files/folder paths
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      // In Electron / Chrome webkitRelativePath or path attribute
      const fullPath = (file as any).path;
      if (fullPath) {
        // If it's a file, get parent directory, otherwise use path
        onSelectFolder(fullPath);
        return;
      }
    }

    // Try text data
    const textData = e.dataTransfer.getData("text/plain");
    if (textData && (textData.startsWith("/") || textData.startsWith("C:\\") || textData.startsWith("~"))) {
      onSelectFolder(textData.trim());
      return;
    }

    // Default fallback to picker
    onOpenDirectoryPicker();
  };

  const handleManualSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (manualPath.trim()) {
      onSelectFolder(manualPath.trim());
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

  return (
    <div className="relative min-h-[calc(100vh-120px)] flex flex-col items-center justify-start max-w-5xl mx-auto py-4 px-4 sm:px-6">
      {/* Ambient background glow backdrop */}
      <div className="absolute top-12 -z-10 w-[550px] h-[350px] bg-gradient-to-tr from-[#0075de]/15 via-[#9b51e0]/10 to-transparent blur-3xl rounded-full pointer-events-none dark:from-[#0075de]/20 dark:via-[#9b51e0]/15" />

      {/* Hero Header & Floating Flying Logo Section */}
      <div className="flex flex-col items-center text-center mt-2 mb-8 relative">
        {/* Replay animation trigger (subtle icon in corner) */}
        <button
          onClick={handleReplayIntro}
          title="Replay flying logo animation"
          className="absolute -top-2 right-0 p-1.5 rounded-full text-[#a39e98] hover:text-[#0075de] dark:hover:text-[#38bdf8] transition hover:bg-[#ffffff] dark:hover:bg-[#252525] border border-transparent hover:border-[#e6e6e6] dark:hover:border-[#333333] cursor-pointer text-xs flex items-center gap-1 opacity-60 hover:opacity-100"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="text-[10px] hidden sm:inline">Replay Intro</span>
        </button>

        {/* Logo Pedestal Container with Flying Entrance or Gentle Float */}
        <div className="relative mb-6">
          {/* Radial shockwave pulse behind logo on landing */}
          <div className="absolute inset-0 -m-4 rounded-3xl bg-[#0075de]/20 dark:bg-[#0075de]/30 blur-xl animate-pulse-glow pointer-events-none" />
          {isFlying && (
            <div className="absolute inset-0 rounded-3xl border-2 border-[#0075de]/40 dark:border-[#38bdf8]/40 animate-ripple pointer-events-none" />
          )}

          {/* Logo container box */}
          <div
            className={`w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-[#ffffff]/90 dark:bg-[#202020]/90 backdrop-blur-xl border-2 border-[#ffffff] dark:border-[#383838] shadow-[0_12px_36px_rgba(0,117,222,0.18),0_2px_8px_rgba(0,0,0,0.06)] dark:shadow-[0_12px_36px_rgba(0,0,0,0.6),0_0_20px_rgba(0,117,222,0.25)] flex items-center justify-center p-3 relative group transition-transform ${
              isFlying ? "animate-fly-intro" : "animate-float hover:scale-105"
            }`}
          >
            <img
              src={logoImg}
              alt="TidyFlow Logo"
              className="w-full h-full object-contain filter drop-shadow-md select-none pointer-events-none"
            />

            {/* Sparkle decorative pill */}
            <div className="absolute -bottom-2 -right-2 bg-gradient-to-r from-[#0075de] to-[#9b51e0] text-white p-1.5 rounded-full shadow-md">
              <Sparkles className="w-3.5 h-3.5 animate-spin" style={{ animationDuration: "8s" }} />
            </div>
          </div>
        </div>

        {/* Hero Title & Subtitle with Staggered Fade */}
        <div className={isFlying ? "animate-slide-up-1" : ""}>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#0075de]/10 dark:bg-[#0075de]/20 border border-[#0075de]/25 text-[#0075de] dark:text-[#38bdf8] text-[11px] font-bold tracking-wider uppercase mb-3 shadow-2xs">
            <Sparkles className="w-3 h-3" />
            <span>Intelligent Desktop Organizer</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-extrabold text-[#000000] dark:text-[#ffffff] tracking-tight leading-tight mb-3">
            Bring Order to Your Digital Workspace
          </h1>

          <p className="text-[14px] sm:text-[15px] text-[#615d59] dark:text-[#a1a1aa] max-w-xl mx-auto leading-relaxed">
            Drop any cluttered folder to automatically analyze, categorize, and organize your files with surgical precision.
          </p>
        </div>
      </div>

      {/* Main Interactive Action Zone: Drag & Drop Hero */}
      <div className={`w-full max-w-2xl mb-8 ${isFlying ? "animate-slide-up-2" : ""}`}>
        <div
          onDragOver={handleDragOver}
          onDragEnter={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative rounded-2xl border-2 border-dashed p-8 sm:p-10 text-center transition-all cursor-pointer group ${
            isDragging
              ? "border-[#0075de] dark:border-[#38bdf8] bg-[#0075de]/10 dark:bg-[#0075de]/20 scale-[1.01] shadow-[0_0_30px_rgba(0,117,222,0.25)]"
              : "border-[#d6d5d2] dark:border-[#383838] bg-[#ffffff]/80 dark:bg-[#202020]/80 hover:border-[#0075de]/70 dark:hover:border-[#38bdf8]/70 hover:bg-[#ffffff] dark:hover:bg-[#242424] shadow-[0_4px_20px_rgba(0,0,0,0.03)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.3)]"
          }`}
          onClick={handleNativeBrowse}
        >
          {/* Animated Glow on hover */}
          <div className="w-16 h-16 sm:w-20 sm:h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-b from-[#0075de]/10 to-[#9b51e0]/10 dark:from-[#0075de]/20 dark:to-[#9b51e0]/20 flex items-center justify-center text-[#0075de] dark:text-[#38bdf8] group-hover:scale-110 transition-transform duration-300 shadow-inner">
            <FolderOpen className="w-8 h-8 sm:w-10 sm:h-10" />
          </div>

          <h3 className="text-lg font-bold text-[#000000] dark:text-[#ffffff] mb-1.5">
            {isDragging ? "Drop folder to start!" : "Drag and drop any folder here"}
          </h3>
          <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97] mb-5 max-w-md mx-auto">
            Select your messy Downloads, Desktop, or Project directory. Files remain 100% safe.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleNativeBrowse();
              }}
              disabled={isNativeBrowsing}
              className="px-5 py-2.5 rounded-xl bg-[#0075de] hover:bg-[#005bab] dark:bg-[#2383e2] dark:hover:bg-[#1a73e8] text-white font-semibold text-[13px] shadow-[0_2px_8px_rgba(0,117,222,0.35)] flex items-center gap-2 cursor-pointer transition active:scale-95"
            >
              <FolderOpen className="w-4 h-4" />
              <span>{isNativeBrowsing ? "Opening Dialog..." : "Choose Folder with Finder..."}</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDirectoryPicker();
              }}
              className="px-4 py-2.5 rounded-xl bg-[#f6f5f4] dark:bg-[#2c2c2c] hover:bg-[#eae8e5] dark:hover:bg-[#383838] border border-[#e6e6e6] dark:border-[#3a3a3a] text-[#31302e] dark:text-[#e4e4e7] font-semibold text-[13px] flex items-center gap-1.5 cursor-pointer transition"
            >
              <Compass className="w-4 h-4 text-[#615d59] dark:text-[#a1a1aa]" />
              <span>In-App Browser</span>
            </button>
          </div>

          {/* Optional manual path toggle */}
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
                Or enter folder path manually
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
                  Start
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
      </div>

      {/* Quick Launch Bookmarks Section */}
      {quickLocations.length > 0 && (
        <div className={`w-full max-w-4xl mb-8 ${isFlying ? "animate-slide-up-3" : ""}`}>
          <div className="flex items-center justify-between mb-3 px-1">
            <h4 className="text-xs font-bold uppercase tracking-wider text-[#615d59] dark:text-[#a1a1aa] flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#0075de] dark:text-[#38bdf8]" />
              <span>Quick Start Bookmarks</span>
            </h4>
            <span className="text-[11px] text-[#a39e98]">Click any location to launch</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
            {quickLocations.map((loc) => (
              <button
                key={loc.path}
                onClick={() => onSelectFolder(loc.path)}
                className="group p-3.5 rounded-xl bg-[#ffffff] dark:bg-[#202020] border border-[#e6e6e6] dark:border-[#2e2e2e] hover:border-[#0075de] dark:hover:border-[#38bdf8] hover:shadow-[0_4px_16px_rgba(0,117,222,0.12)] dark:hover:shadow-[0_4px_16px_rgba(0,0,0,0.4)] transition-all text-left flex items-center justify-between cursor-pointer hover:-translate-y-0.5"
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="w-10 h-10 rounded-lg bg-[#f6f5f4] dark:bg-[#282828] group-hover:bg-[#0075de]/10 dark:group-hover:bg-[#0075de]/20 flex items-center justify-center shrink-0 transition-colors">
                    {getLocationIcon(loc.name)}
                  </div>
                  <div className="truncate">
                    <p className="text-[13px] font-bold text-[#000000] dark:text-[#ffffff] group-hover:text-[#0075de] dark:group-hover:text-[#38bdf8] transition-colors truncate">
                      {loc.name}
                    </p>
                    <p className="text-[10px] font-mono text-[#a39e98] truncate" title={loc.path}>
                      {loc.path.replace(/^.*[\\/]/, "") || loc.path}
                    </p>
                  </div>
                </div>
                <ArrowRight className="w-4 h-4 text-[#a39e98] group-hover:text-[#0075de] dark:group-hover:text-[#38bdf8] group-hover:translate-x-0.5 transition-all shrink-0 ml-1" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recent Workspace / Last Activity Pill */}
      {recentFolder && (
        <div className={`w-full max-w-4xl mb-8 ${isFlying ? "animate-slide-up-3" : ""}`}>
          <div className="p-4 rounded-xl bg-gradient-to-r from-[#ffffff] via-[#ffffff] to-[#f6f5f4] dark:from-[#202020] dark:via-[#202020] dark:to-[#252525] border border-[#e6e6e6] dark:border-[#2e2e2e] flex flex-wrap items-center justify-between gap-3 shadow-2xs">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-[#1aae39]/10 text-[#1aae39] dark:text-[#4ade80] flex items-center justify-center shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-xs font-bold text-[#000000] dark:text-[#ffffff]">
                  Previous Workspace: <span className="font-mono text-[#0075de] dark:text-[#38bdf8]">{recentFolder}</span>
                </p>
                <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97]">
                  {recentSummary?.total_scanned
                    ? `${recentSummary.total_scanned} files categorized & indexed in latest run`
                    : "Ready to review or re-organize"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {outputFolder && onOpenOutputFolder && (
                <button
                  type="button"
                  onClick={() => onOpenOutputFolder(outputFolder)}
                  className="px-3 py-1.5 rounded-lg bg-[#f6f5f4] dark:bg-[#2a2a2a] hover:bg-[#eae8e5] dark:hover:bg-[#333333] border border-[#e6e6e6] dark:border-[#383838] text-[11px] font-semibold text-[#31302e] dark:text-[#d4d4d4] flex items-center gap-1 cursor-pointer"
                >
                  <FolderDown className="w-3.5 h-3.5 text-[#9b51e0]" />
                  <span>Open Output</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onSelectFolder(recentFolder)}
                className="px-3.5 py-1.5 rounded-lg bg-[#0075de] hover:bg-[#005bab] dark:bg-[#2383e2] text-white text-[11px] font-semibold flex items-center gap-1 cursor-pointer shadow-2xs"
              >
                <span>Re-open Workspace</span>
                <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feature & Security Assurance Badges */}
      <div className={`w-full max-w-4xl grid grid-cols-1 sm:grid-cols-3 gap-3 text-left ${isFlying ? "animate-slide-up-3" : ""}`}>
        <div className="p-3.5 rounded-xl bg-[#ffffff]/60 dark:bg-[#1e1e1e]/60 border border-[#e6e6e6]/80 dark:border-[#2a2a2a] flex items-start gap-3">
          <div className="p-2 rounded-lg bg-[#1aae39]/10 text-[#1aae39] dark:text-[#4ade80] shrink-0">
            <ShieldCheck className="w-4 h-4" />
          </div>
          <div>
            <h5 className="text-[12px] font-bold text-[#000000] dark:text-[#ffffff] mb-0.5">100% Non-Destructive</h5>
            <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
              Files are copied safely by default. Originals stay intact with full undo rollback.
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#ffffff]/60 dark:bg-[#1e1e1e]/60 border border-[#e6e6e6]/80 dark:border-[#2a2a2a] flex items-start gap-3">
          <div className="p-2 rounded-lg bg-[#9b51e0]/10 text-[#9b51e0] dark:text-[#c084fc] shrink-0">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h5 className="text-[12px] font-bold text-[#000000] dark:text-[#ffffff] mb-0.5">AI File Architect</h5>
            <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
              Smart OCR & LLM classification according to your plain English rules.
            </p>
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-[#ffffff]/60 dark:bg-[#1e1e1e]/60 border border-[#e6e6e6]/80 dark:border-[#2a2a2a] flex items-start gap-3">
          <div className="p-2 rounded-lg bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8] shrink-0">
            <Search className="w-4 h-4" />
          </div>
          <div>
            <h5 className="text-[12px] font-bold text-[#000000] dark:text-[#ffffff] mb-0.5">Instant Search Index</h5>
            <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
              Creates a local full-text search index so you can find any document later in milliseconds.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
