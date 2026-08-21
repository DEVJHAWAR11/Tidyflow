import React from "react";
import { TabType, BackendStatus } from "../types";
import { 
  FolderKanban, 
  Tags, 
  CheckCircle2, 
  Search, 
  Settings2, 
  FileText, 
  CircleDot,
  Moon,
  Sun
} from "lucide-react";

interface NavbarProps {
  activeTab: TabType;
  setActiveTab: (tab: TabType) => void;
  backendStatus: BackendStatus;
  hasLlmKey: boolean;
  fileCount: number;
  darkMode: boolean;
  toggleDarkMode: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  backendStatus,
  hasLlmKey,
  fileCount,
  darkMode,
  toggleDarkMode,
}) => {
  const navTabs: { id: TabType; label: string; icon: React.ReactNode; badge?: string | number }[] = [
    { id: "organize", label: "Organize", icon: <FolderKanban className="w-4 h-4" /> },
    { id: "categories", label: "Categories", icon: <Tags className="w-4 h-4" /> },
    { 
      id: "review", 
      label: "Review & Apply", 
      icon: <CheckCircle2 className="w-4 h-4" />,
      badge: fileCount > 0 ? fileCount : undefined
    },
    { id: "search", label: "Search Index", icon: <Search className="w-4 h-4" /> },
    { id: "settings", label: "Settings", icon: <Settings2 className="w-4 h-4" /> },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#ffffff]/90 dark:bg-[#191919]/90 backdrop-blur-md border-b border-[#e6e6e6] dark:border-[#2e2e2e] transition-colors">
      <div className="max-w-7xl mx-auto px-6 py-3 flex flex-wrap items-center justify-between gap-4">
        {/* Left: App Title */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#f6f5f4] dark:bg-[#252525] border border-[#e6e6e6] dark:border-[#333333] flex items-center justify-center text-lg shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            📁
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold text-[#000000] dark:text-[#ffffff] tracking-heading-3 flex items-center gap-1.5">
                TidyFlow
              </h1>
            </div>
            <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97]">Desktop File Organizer</p>
          </div>
        </div>

        {/* Center: Tab Navigation */}
        <nav className="flex items-center bg-[#f6f5f4] dark:bg-[#202020] p-1 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e]">
          {navTabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-1.5 rounded-md text-[13px] font-medium flex items-center gap-2 transition-all cursor-pointer ${
                  isActive
                    ? "bg-[#ffffff] dark:bg-[#2c2c2c] text-[#000000] dark:text-[#ffffff] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.06)] border border-[#e6e6e6]/80 dark:border-[#383838]"
                    : "text-[#615d59] dark:text-[#9b9a97] hover:text-[#000000] dark:hover:text-[#ffffff] hover:bg-[#ffffff]/50 dark:hover:bg-[#282828]"
                }`}
              >
                <span className={isActive ? "text-[#0075de] dark:text-[#2383e2]" : "text-[#615d59] dark:text-[#9b9a97]"}>
                  {tab.icon}
                </span>
                <span>{tab.label}</span>
                {tab.badge !== undefined && (
                  <span
                    className={`text-[11px] px-1.5 py-0.2 rounded-full font-mono font-semibold ${
                      isActive
                        ? "bg-[#0075de] dark:bg-[#2383e2] text-white"
                        : "bg-[#e6e6e6] dark:bg-[#333333] text-[#31302e] dark:text-[#d4d4d4]"
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        {/* Right: Status Badges & Theme Switcher */}
        <div className="flex items-center gap-2.5">
          {/* Backend Status */}
          <div
            className={`px-2.5 py-1 rounded-full text-[12px] font-medium flex items-center gap-1.5 border ${
              backendStatus === "running"
                ? "bg-[#ecf7ed] dark:bg-[#0c3917]/40 text-[#166534] dark:text-[#4ade80] border-[#1aae39]/30 dark:border-[#1aae39]/30"
                : backendStatus === "checking"
                ? "bg-[#fef3eb] dark:bg-[#4a1c07]/40 text-[#9a3412] dark:text-[#fb923c] border-[#dd5b00]/30 dark:border-[#dd5b00]/30"
                : "bg-[#fdeef8] dark:bg-[#4d0c36]/40 text-[#9d174d] dark:text-[#f472b6] border-[#ff64c8]/30 dark:border-[#ff64c8]/30"
            }`}
          >
            <CircleDot
              className={`w-3 h-3 ${
                backendStatus === "running" ? "text-[#1aae39] dark:text-[#4ade80] animate-pulse" : "text-[#dd5b00]"
              }`}
            />
            <span className="capitalize">
              {backendStatus === "running" ? "Connected" : backendStatus}
            </span>
          </div>

          {/* Model Status */}
          <div
            className={`px-2.5 py-1 rounded-full text-[12px] font-medium flex items-center gap-1.5 border ${
              hasLlmKey
                ? "bg-[#f5eefc] dark:bg-[#3b1959]/40 text-[#581c87] dark:text-[#d8b4fe] border-[#d6b6f6]/50 dark:border-[#9b51e0]/30"
                : "bg-[#fef3eb] dark:bg-[#4a1c07]/40 text-[#9a3412] dark:text-[#fb923c] border-[#dd5b00]/30 dark:border-[#dd5b00]/30"
            }`}
          >
            <FileText className="w-3 h-3 text-[#9b51e0] dark:text-[#d8b4fe]" />
            <span>{hasLlmKey ? "Language Model Active" : "Rule Matching"}</span>
          </div>

          {/* Theme Toggle */}
          <button
            onClick={toggleDarkMode}
            title={darkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
            className="p-2 rounded-lg bg-[#f6f5f4] dark:bg-[#252525] hover:bg-[#eae8e5] dark:hover:bg-[#333333] border border-[#e6e6e6] dark:border-[#333333] text-[#31302e] dark:text-[#d4d4d4] transition cursor-pointer active:scale-95"
          >
            {darkMode ? (
              <Sun className="w-4 h-4 text-[#fbbf24]" />
            ) : (
              <Moon className="w-4 h-4 text-[#615d59]" />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
