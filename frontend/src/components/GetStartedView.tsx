import React, { useState, useEffect } from "react";
import logoImg from "../assets/logo.png";
import {
  Sparkles,
  ShieldCheck,
  Zap,
  ArrowRight,
  RotateCcw,
  CheckCircle2,
  Layers,
  Lock,
} from "lucide-react";

interface GetStartedViewProps {
  onGetStarted: () => void;
  recentFolder?: string;
  recentSummary?: { total_scanned?: number; text_extracted?: number } | null;
  outputFolder?: string;
  onResumeRecent?: () => void;
  onOpenOutputFolder?: (path: string) => void;
}

export const GetStartedView: React.FC<GetStartedViewProps> = ({
  onGetStarted,
  recentFolder,
  outputFolder,
  onResumeRecent,
  onOpenOutputFolder,
}) => {
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

  return (
    <div className="relative min-h-[calc(100vh-140px)] flex flex-col items-center justify-center max-w-4xl mx-auto py-8 px-4 sm:px-6">
      {/* Ambient background glow backdrops */}
      <div className="absolute top-1/4 -z-10 w-[580px] h-[360px] bg-gradient-to-tr from-[#0075de]/20 via-[#9b51e0]/15 to-transparent blur-3xl rounded-full pointer-events-none dark:from-[#0075de]/25 dark:via-[#9b51e0]/20" />
      <div className="absolute bottom-10 -z-10 w-[400px] h-[250px] bg-gradient-to-br from-[#1aae39]/10 via-[#0075de]/10 to-transparent blur-3xl rounded-full pointer-events-none" />

      {/* Replay animation trigger */}
      <button
        onClick={handleReplayIntro}
        title="Replay flying logo animation"
        className="absolute top-2 right-2 sm:right-6 p-1.5 rounded-full text-[#a39e98] hover:text-[#0075de] dark:hover:text-[#38bdf8] transition hover:bg-[#ffffff] dark:hover:bg-[#252525] border border-transparent hover:border-[#e6e6e6] dark:hover:border-[#333333] cursor-pointer text-xs flex items-center gap-1 opacity-60 hover:opacity-100"
      >
        <RotateCcw className="w-3.5 h-3.5" />
        <span className="text-[10px] hidden sm:inline">Replay Intro</span>
      </button>

      {/* Main Hero Header Section */}
      <div className="flex flex-col items-center text-center mb-10 relative">
        {/* Logo Pedestal Container with Flying Entrance or Gentle Float */}
        <div className="relative mb-6">
          {/* Radial shockwave pulse behind logo on landing */}
          <div className="absolute inset-0 -m-5 rounded-3xl bg-[#0075de]/25 dark:bg-[#0075de]/35 blur-2xl animate-pulse-glow pointer-events-none" />
          {isFlying && (
            <div className="absolute inset-0 rounded-3xl border-2 border-[#0075de]/50 dark:border-[#38bdf8]/50 animate-ripple pointer-events-none" />
          )}

          {/* Logo container box */}
          <div
            className={`w-28 h-28 sm:w-32 sm:h-32 rounded-3xl bg-[#ffffff]/95 dark:bg-[#202020]/95 backdrop-blur-xl border border-[#e6e6e6] dark:border-[#383838] shadow-[0_12px_32px_rgba(0,117,222,0.12),0_2px_8px_rgba(0,0,0,0.04)] dark:shadow-[0_16px_40px_rgba(0,0,0,0.6)] flex items-center justify-center p-4 relative transition-transform ${
              isFlying ? "animate-fly-intro" : ""
            }`}
          >
            <img
              src={logoImg}
              alt="TidyFlow Logo"
              className="w-full h-full object-contain select-none pointer-events-none"
            />
          </div>
        </div>

        {/* Hero Title & Subtitle with Staggered Fade */}
        <div className={isFlying ? "animate-slide-up-1" : ""}>
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-[#0075de]/10 dark:bg-[#0075de]/20 border border-[#0075de]/25 text-[#0075de] dark:text-[#38bdf8] text-[11px] font-bold tracking-wider uppercase mb-4 shadow-2xs">
            <Sparkles className="w-3.5 h-3.5" />
            <span>Intelligent Desktop Organizer</span>
          </div>

          <h1 className="text-3xl sm:text-5xl font-extrabold text-[#000000] dark:text-[#ffffff] tracking-tight leading-tight mb-4">
            Bring Order to Your Digital Chaos
          </h1>

          <p className="text-[15px] sm:text-base text-[#615d59] dark:text-[#a1a1aa] max-w-xl mx-auto leading-relaxed">
            Scan messy folders, classify documents with smart OCR & local AI heuristics, and establish an organized file taxonomy in seconds.
          </p>
        </div>
      </div>

      {/* Primary Action Button (Clean, Simple & Modern) */}
      <div className={`mb-12 flex flex-col items-center gap-3 ${isFlying ? "animate-slide-up-2" : ""}`}>
        <button
          onClick={onGetStarted}
          className="px-8 py-3 rounded-xl bg-[#0075de] hover:bg-[#005bab] dark:bg-[#2383e2] dark:hover:bg-[#1a73e8] text-white font-semibold text-[14px] shadow-sm hover:shadow-md transition-all flex items-center gap-2 cursor-pointer active:scale-97"
        >
          <span>Get Started</span>
          <ArrowRight className="w-4 h-4" />
        </button>

        <p className="text-xs text-[#a39e98] flex items-center gap-1.5">
          <Lock className="w-3 h-3 text-[#1aae39]" />
          <span>Non-destructive • Files copied safely with instant rollback</span>
        </p>
      </div>

      {/* 3 Core Value Pillars */}
      <div className={`w-full grid grid-cols-1 md:grid-cols-3 gap-4 mb-8 ${isFlying ? "animate-slide-up-3" : ""}`}>
        <div className="p-5 rounded-2xl bg-[#ffffff]/80 dark:bg-[#202020]/80 backdrop-blur-md border border-[#e6e6e6] dark:border-[#2e2e2e] hover:border-[#0075de]/50 transition-all shadow-[0_2px_12px_rgba(0,0,0,0.02)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
          <div className="w-10 h-10 rounded-xl bg-[#0075de]/10 dark:bg-[#0075de]/20 text-[#0075de] dark:text-[#38bdf8] flex items-center justify-center mb-3.5">
            <Zap className="w-5 h-5" />
          </div>
          <h4 className="text-[14px] font-bold text-[#000000] dark:text-[#ffffff] mb-1.5">
            Smart Content Inspection
          </h4>
          <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
            Extracts text, metadata, and OCR from PDFs, images, and code to categorize files by meaning, not just file names.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#ffffff]/80 dark:bg-[#202020]/80 backdrop-blur-md border border-[#e6e6e6] dark:border-[#2e2e2e] hover:border-[#9b51e0]/50 transition-all shadow-[0_2px_12px_rgba(0,0,0,0.02)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
          <div className="w-10 h-10 rounded-xl bg-[#9b51e0]/10 dark:bg-[#9b51e0]/20 text-[#9b51e0] dark:text-[#c084fc] flex items-center justify-center mb-3.5">
            <Layers className="w-5 h-5" />
          </div>
          <h4 className="text-[14px] font-bold text-[#000000] dark:text-[#ffffff] mb-1.5">
            Custom AI Blueprints
          </h4>
          <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
            Describe your folder structure in plain English or select from pre-tuned templates for Finance, Work, Media, or Code.
          </p>
        </div>

        <div className="p-5 rounded-2xl bg-[#ffffff]/80 dark:bg-[#202020]/80 backdrop-blur-md border border-[#e6e6e6] dark:border-[#2e2e2e] hover:border-[#1aae39]/50 transition-all shadow-[0_2px_12px_rgba(0,0,0,0.02)] dark:shadow-[0_2px_12px_rgba(0,0,0,0.3)]">
          <div className="w-10 h-10 rounded-xl bg-[#1aae39]/10 dark:bg-[#1aae39]/20 text-[#1aae39] dark:text-[#4ade80] flex items-center justify-center mb-3.5">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <h4 className="text-[14px] font-bold text-[#000000] dark:text-[#ffffff] mb-1.5">
            Safety & Audit Staging
          </h4>
          <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] leading-relaxed">
            Review side-by-side classification diffs with interactive confidence scores before committing any changes.
          </p>
        </div>
      </div>

      {/* Returning User Recent Activity (Optional Shortcut) */}
      {recentFolder && (
        <div className={`w-full max-w-xl p-3.5 rounded-xl bg-[#ffffff]/60 dark:bg-[#222222]/60 border border-[#e6e6e6] dark:border-[#333333] flex items-center justify-between gap-3 text-xs ${isFlying ? "animate-slide-up-3" : ""}`}>
          <div className="flex items-center gap-2.5 truncate">
            <CheckCircle2 className="w-4 h-4 text-[#1aae39] shrink-0" />
            <span className="text-[#615d59] dark:text-[#9b9a97] truncate">
              Last workspace: <span className="font-mono text-[#000000] dark:text-[#ffffff] font-semibold">{recentFolder}</span>
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {outputFolder && onOpenOutputFolder && (
              <button
                type="button"
                onClick={() => onOpenOutputFolder(outputFolder)}
                className="text-[11px] text-[#615d59] dark:text-[#d4d4d4] hover:text-[#000000] dark:hover:text-[#ffffff] underline cursor-pointer"
              >
                View Output
              </button>
            )}
            {onResumeRecent && (
              <button
                type="button"
                onClick={onResumeRecent}
                className="px-2.5 py-1 rounded-md bg-[#0075de]/10 text-[#0075de] dark:text-[#38bdf8] font-bold hover:bg-[#0075de]/20 cursor-pointer"
              >
                Resume →
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
