import { useState, useEffect, useMemo } from "react";

// --- Types ---
interface CategoryItem {
  name: string;
  description: string;
  keywords: string[];
  extensions: string[];
  active: boolean;
}

interface ClassifiedFile {
  file_id: string;
  filename: string;
  abs_path: string;
  rel_path: string;
  extension: string;
  file_size_bytes: number;
  file_category: string;
  category: string;
  confidence: number;
  suggested_filename?: string;
  reason?: string;
  action: string;
  source: string;
  thumbnail_b64?: string;
  extracted_text?: string;
  duplicate_group_id?: string;
  near_duplicate_group_id?: string;
  keyword_scores?: Record<string, number>;
}

interface RunSummary {
  total_scanned: number;
  total_skipped: number;
  text_extracted: number;
  ocr_processed: number;
  ocr_cached: number;
  exact_duplicates: number;
  near_duplicates: number;
  heuristic_classified: number;
  llm_classified: number;
  manual_review: number;
}

interface ApplyDecisionItem {
  file_id: string;
  approved: boolean;
  override_category?: string;
  target_filename?: string;
}

const API_BASE = "http://localhost:8000";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"organize" | "categories" | "review" | "search" | "settings">("organize");
  const [backendStatus, setBackendStatus] = useState<"running" | "offline" | "checking">("checking");
  const [hasLlmKey, setHasLlmKey] = useState(false);

  // Organize tab state
  const [inputFolder, setInputFolder] = useState("/Users/arpan/test files");
  const [outputFolder, setOutputFolder] = useState("/Users/arpan/test files/Organized_Output");
  const [useLlm, setUseLlm] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>("");
  const [progressLogs, setProgressLogs] = useState<string[]>([]);

  // Categories state
  const [categories, setCategories] = useState<Record<string, CategoryItem>>({});
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");
  const [newCatDesc, setNewCatDesc] = useState("");
  const [newCatKeywords, setNewCatKeywords] = useState("");
  const [newCatExtensions, setNewCatExtensions] = useState("");

  // Review & Apply state
  const [files, setFiles] = useState<ClassifiedFile[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({});
  const [searchQuery, setSearchQuery] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [filterConfidence, setFilterConfidence] = useState<"all" | "high" | "review">("all");
  const [moveMode, setMoveMode] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResultModal, setApplyResultModal] = useState<{ count: number; action: string; output_dir: string } | null>(null);

  // Search tab state
  const [ftsQuery, setFtsQuery] = useState("");
  const [ftsResults, setFtsResults] = useState<any[]>([]);
  const [isSearchingFts, setIsSearchingFts] = useState(false);

  // Settings state
  const [llmProvider, setLlmProvider] = useState("deepseek");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [autoThreshold, setAutoThreshold] = useState(0.85);
  const [maskedKey, setMaskedKey] = useState("");
  const [saveSettingsSuccess, setSaveSettingsSuccess] = useState(false);

  // --- API Handlers ---

  const checkStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (res.ok) {
        const data = await res.json();
        setBackendStatus("running");
        setHasLlmKey(data.has_llm_key);
      } else {
        setBackendStatus("offline");
      }
    } catch {
      setBackendStatus("offline");
    }
  };

  const fetchCategories = async () => {
    try {
      const res = await fetch(`${API_BASE}/categories`);
      if (res.ok) {
        const data = await res.json();
        setCategories(data.categories || {});
      }
    } catch (e) {
      console.error("Failed to load categories:", e);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`);
      if (res.ok) {
        const data = await res.json();
        setLlmProvider(data.provider || "deepseek");
        setMaskedKey(data.masked_key || "");
        setAutoThreshold(data.auto_copy_threshold || 0.85);
      }
    } catch (e) {
      console.error("Failed to load settings:", e);
    }
  };

  const fetchLatestReport = async () => {
    try {
      const res = await fetch(`${API_BASE}/pipeline/latest`);
      if (res.ok) {
        const data = await res.json();
        if (data.files && data.files.length > 0) {
          setFiles(data.files);
          setSummary(data.summary);
          if (data.output_dir) setOutputFolder(data.output_dir);
          if (data.input_dir) setInputFolder(data.input_dir);
          // Pre-select high confidence files
          const initialSelected = new Set<string>();
          data.files.forEach((f: ClassifiedFile) => {
            if (f.confidence >= 0.85 && f.category !== "Unknown") {
              initialSelected.add(f.file_id);
            }
          });
          setSelectedFileIds(initialSelected);
        }
      }
    } catch (e) {
      console.error("Failed to fetch latest report:", e);
    }
  };

  useEffect(() => {
    checkStatus();
    fetchCategories();
    fetchSettings();
    fetchLatestReport();
    const interval = setInterval(checkStatus, 6000);
    return () => clearInterval(interval);
  }, []);

  // --- Category Actions ---

  const handleToggleCategory = (catName: string) => {
    setCategories((prev) => {
      const existing = prev[catName];
      if (!existing) return prev;
      return {
        ...prev,
        [catName]: { ...existing, active: !existing.active },
      };
    });
  };

  const handleAddCategory = async () => {
    const trimmedName = newCatName.trim();
    if (!trimmedName) return;

    const kwList = newCatKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const extList = newCatExtensions
      .split(",")
      .map((e) => (e.trim().startsWith(".") ? e.trim() : "." + e.trim()))
      .filter(Boolean);

    const updated = {
      ...categories,
      [trimmedName]: {
        name: trimmedName,
        description: newCatDesc.trim() || trimmedName,
        keywords: kwList,
        extensions: extList,
        active: true,
      },
    };

    setCategories(updated);
    setIsAddingCategory(false);
    setNewCatName("");
    setNewCatDesc("");
    setNewCatKeywords("");
    setNewCatExtensions("");

    try {
      await fetch(`${API_BASE}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: updated }),
      });
    } catch (e) {
      console.error("Failed to save categories:", e);
    }
  };

  const handleDeleteCategory = async (catName: string) => {
    const updated = { ...categories };
    delete updated[catName];
    setCategories(updated);

    try {
      await fetch(`${API_BASE}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: updated }),
      });
    } catch (e) {
      console.error("Failed to delete category:", e);
    }
  };

  // --- Pipeline Execution ---

  const handleStartPipeline = async () => {
    if (!inputFolder.trim()) return;
    setIsRunning(true);
    setCurrentStage("Scanning directory & computing hashes...");
    setProgressLogs([`> Starting scan on ${inputFolder}`]);

    const activeCats: Record<string, any> = {};
    Object.entries(categories).forEach(([name, item]) => {
      if (item.active) {
        activeCats[name] = {
          description: item.description,
          keywords: item.keywords,
          extensions: item.extensions,
        };
      }
    });

    try {
      const res = await fetch(`${API_BASE}/pipeline/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          input_dir: inputFolder.trim(),
          output_dir: outputFolder.trim() || undefined,
          use_llm: useLlm,
          custom_categories: Object.keys(activeCats).length > 0 ? activeCats : undefined,
          auto_apply: false,
          dry_run: true,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || "Pipeline run failed");
      }

      setFiles(data.files || []);
      setSummary(data.summary || null);
      if (data.output_dir) setOutputFolder(data.output_dir);

      // Auto-select files with confidence >= autoThreshold
      const preselected = new Set<string>();
      (data.files || []).forEach((f: ClassifiedFile) => {
        if (f.confidence >= autoThreshold && f.category !== "Unknown") {
          preselected.add(f.file_id);
        }
      });
      setSelectedFileIds(preselected);

      setCurrentStage("Complete!");
      setProgressLogs((prev) => [...prev, `✓ Processed ${data.files?.length || 0} files successfully!`]);

      // Switch to review tab directly
      setTimeout(() => {
        setActiveTab("review");
      }, 700);
    } catch (err: any) {
      setProgressLogs((prev) => [...prev, `✗ Error: ${err.message}`]);
      setCurrentStage("Failed");
    } finally {
      setIsRunning(false);
    }
  };

  // --- Direct Apply Actions ---

  const handleApplyDecisions = async () => {
    if (selectedFileIds.size === 0) {
      alert("Please select at least one file to organize.");
      return;
    }

    setIsApplying(true);
    const decisionList: ApplyDecisionItem[] = [];

    files.forEach((f) => {
      const isApproved = selectedFileIds.has(f.file_id);
      const override = categoryOverrides[f.file_id];
      decisionList.push({
        file_id: f.file_id,
        approved: isApproved,
        override_category: override || undefined,
        target_filename: f.suggested_filename || undefined,
      });
    });

    try {
      const res = await fetch(`${API_BASE}/pipeline/apply-direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          output_dir: outputFolder,
          decisions: decisionList,
          dry_run: false,
          move_mode: moveMode,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.detail || data.error || "Failed to apply decisions");
      }

      setApplyResultModal({
        count: data.applied_count,
        action: data.action,
        output_dir: data.output_dir,
      });
    } catch (err: any) {
      alert(`Failed to apply changes: ${err.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  // --- Save Settings ---

  const handleSaveSettings = async () => {
    try {
      const res = await fetch(`${API_BASE}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider: llmProvider,
          api_key: apiKeyInput.trim() || undefined,
          auto_copy_threshold: autoThreshold,
        }),
      });
      if (res.ok) {
        setSaveSettingsSuccess(true);
        setApiKeyInput("");
        fetchSettings();
        checkStatus();
        setTimeout(() => setSaveSettingsSuccess(false), 3000);
      }
    } catch (e) {
      console.error("Save settings error:", e);
    }
  };

  // --- Filtered Files Memo ---

  const filteredFiles = useMemo(() => {
    return files.filter((f) => {
      const activeCat = categoryOverrides[f.file_id] || f.category;
      if (filterCategory !== "all" && activeCat !== filterCategory) return false;
      if (filterConfidence === "high" && f.confidence < autoThreshold) return false;
      if (filterConfidence === "review" && f.confidence >= autoThreshold) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = f.filename.toLowerCase().includes(q);
        const matchesCat = activeCat.toLowerCase().includes(q);
        const matchesText = (f.extracted_text || "").toLowerCase().includes(q);
        const matchesReason = (f.reason || "").toLowerCase().includes(q);
        if (!matchesName && !matchesCat && !matchesText && !matchesReason) return false;
      }
      return true;
    });
  }, [files, categoryOverrides, filterCategory, filterConfidence, searchQuery, autoThreshold]);

  const uniqueCategories = useMemo(() => {
    const set = new Set<string>();
    files.forEach((f) => {
      const cat = categoryOverrides[f.file_id] || f.category;
      if (cat) set.add(cat);
    });
    return Array.from(set).sort();
  }, [files, categoryOverrides]);

  // --- Selection Helpers ---

  const toggleSelectFile = (fileId: string) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  };

  const selectAllFiltered = () => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      filteredFiles.forEach((f) => next.add(f.file_id));
      return next;
    });
  };

  const deselectAllFiltered = () => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      filteredFiles.forEach((f) => next.delete(f.file_id));
      return next;
    });
  };

  // --- Search Tab FTS ---

  const handleFtsSearch = async () => {
    if (!ftsQuery.trim()) return;
    setIsSearchingFts(true);
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(ftsQuery.trim())}`);
      if (res.ok) {
        const data = await res.json();
        setFtsResults(data.results || []);
      }
    } catch (e) {
      console.error("FTS search error:", e);
    } finally {
      setIsSearchingFts(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-indigo-500 selection:text-white">
      {/* Top Navbar */}
      <header className="bg-slate-900/90 backdrop-blur-md border-b border-slate-800 px-6 py-4 flex justify-between items-center sticky top-0 z-40 shadow-lg shadow-black/20">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/25">
            <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 via-purple-300 to-pink-400">
              TidyFlow 2.0
            </h1>
            <p className="text-xs text-slate-400 font-medium">Universal AI File Organizer</p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center bg-slate-950/60 p-1 rounded-xl border border-slate-800/80">
          {[
            { id: "organize", label: "1. Organize Folder", icon: "📁" },
            { id: "categories", label: "2. Categories", icon: "🏷️" },
            { id: "review", label: `3. Review & Apply (${files.length})`, icon: "⚡" },
            { id: "search", label: "Search Index", icon: "🔍" },
            { id: "settings", label: "Settings", icon: "⚙️" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 transition-all duration-200 ${
                activeTab === tab.id
                  ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/30 font-bold"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
              }`}
            >
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        {/* Backend & Key Status Badges */}
        <div className="flex items-center gap-3">
          <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 border ${
            backendStatus === "running"
              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              : "bg-red-500/10 text-red-400 border-red-500/30"
          }`}>
            <span className={`w-2 h-2 rounded-full ${backendStatus === "running" ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
            <span>Backend: {backendStatus}</span>
          </div>

          <div className={`px-3 py-1 rounded-full text-xs font-medium flex items-center gap-1.5 border ${
            hasLlmKey
              ? "bg-purple-500/10 text-purple-300 border-purple-500/30"
              : "bg-amber-500/10 text-amber-300 border-amber-500/30"
          }`}>
            <span>{hasLlmKey ? "🔑 DeepSeek Ready" : "⚠️ Key Missing"}</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
        {/* TAB 1: ORGANIZE (Pipeline Runner) */}
        {activeTab === "organize" && (
          <div className="space-y-6 animate-fade-in">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Left 2 Cols: Setup inputs */}
              <div className="md:col-span-2 space-y-6 bg-slate-900/60 p-6 rounded-2xl border border-slate-800 shadow-xl">
                <div>
                  <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    <span>📂</span> Choose Input Directory
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Specify the messy directory you want TidyFlow to scan and categorize.
                  </p>

                  <div className="mt-3">
                    <input
                      type="text"
                      value={inputFolder}
                      onChange={(e) => setInputFolder(e.target.value)}
                      placeholder="/Users/username/Downloads"
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-3 text-sm font-mono text-indigo-200 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
                    />
                  </div>

                  {/* Quick Preset Folder Chips */}
                  <div className="flex flex-wrap gap-2 mt-2.5">
                    <span className="text-xs text-slate-500 self-center">Presets:</span>
                    {[
                      "/Users/arpan/test files",
                      "/Users/arpan/Downloads",
                      "/Users/arpan/Documents",
                      "/Users/arpan/Desktop",
                    ].map((preset) => (
                      <button
                        key={preset}
                        onClick={() => {
                          setInputFolder(preset);
                          setOutputFolder(`${preset}/Organized_Output`);
                        }}
                        className="px-2.5 py-1 text-xs rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 font-mono transition border border-slate-700/50"
                      >
                        {preset.split("/").pop()}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Output Directory */}
                <div className="pt-4 border-t border-slate-800">
                  <h2 className="text-lg font-bold text-slate-100 flex items-center gap-2">
                    <span>🎯</span> Destination Output Directory
                  </h2>
                  <p className="text-xs text-slate-400 mt-1">
                    Files will be safely organized into category subdirectories here.
                  </p>
                  <div className="mt-3">
                    <input
                      type="text"
                      value={outputFolder}
                      onChange={(e) => setOutputFolder(e.target.value)}
                      placeholder="/Users/username/test files/Organized_Output"
                      className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-4 py-3 text-sm font-mono text-purple-200 focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition"
                    />
                  </div>
                </div>

                {/* Options & Classification Mode */}
                <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        checked={useLlm}
                        onChange={(e) => setUseLlm(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-11 h-6 bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-indigo-600"></div>
                      <span className="ml-3 text-xs font-semibold text-slate-200">
                        Enable DeepSeek AI Reasoning
                      </span>
                    </label>
                  </div>

                  <button
                    onClick={handleStartPipeline}
                    disabled={isRunning || backendStatus !== "running"}
                    className={`px-8 py-3.5 rounded-xl font-bold text-sm flex items-center gap-2 shadow-xl transition-all transform active:scale-95 ${
                      isRunning || backendStatus !== "running"
                        ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                        : "bg-gradient-to-r from-indigo-600 via-purple-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white shadow-indigo-500/25 hover:shadow-indigo-500/40"
                    }`}
                  >
                    {isRunning ? (
                      <>
                        <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Analyzing & Organizing...</span>
                      </>
                    ) : (
                      <>
                        <span>🚀</span>
                        <span>Start Organizing</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Right Col: Category preview & summary */}
              <div className="space-y-6">
                <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 shadow-xl">
                  <div className="flex justify-between items-center mb-3">
                    <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2">
                      <span>🏷️</span> Active Taxonomy
                    </h3>
                    <button
                      onClick={() => setActiveTab("categories")}
                      className="text-xs text-indigo-400 hover:text-indigo-300 font-semibold underline"
                    >
                      Manage ({Object.keys(categories).length})
                    </button>
                  </div>
                  <p className="text-xs text-slate-400 mb-3">
                    Files will be matched against these configured categories:
                  </p>
                  <div className="flex flex-wrap gap-1.5 max-h-56 overflow-y-auto pr-1">
                    {Object.entries(categories).map(([name, cat]) => (
                      <span
                        key={name}
                        className={`text-[11px] px-2.5 py-1 rounded-lg font-mono border ${
                          cat.active
                            ? "bg-slate-800 text-indigo-300 border-indigo-500/20"
                            : "bg-slate-950 text-slate-600 border-slate-800 line-through"
                        }`}
                      >
                        {name}
                      </span>
                    ))}
                  </div>
                </div>

                {/* Safety Guarantee Callout */}
                <div className="bg-gradient-to-br from-emerald-950/30 to-slate-900 p-5 rounded-2xl border border-emerald-500/20 shadow-lg">
                  <h4 className="text-xs font-bold text-emerald-400 flex items-center gap-1.5">
                    <span>🛡️</span> Safety Guarantee
                  </h4>
                  <p className="text-xs text-slate-300 mt-1.5 leading-relaxed">
                    By default, TidyFlow <strong>copies</strong> files to the destination. Original files in the source directory are never deleted without your explicit confirmation.
                  </p>
                </div>
              </div>
            </div>

            {/* Live Progress Stage */}
            {(isRunning || progressLogs.length > 0) && (
              <div className="bg-slate-900/90 rounded-2xl p-6 border border-slate-800 shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    {isRunning && (
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-indigo-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-indigo-500"></span>
                      </span>
                    )}
                    <h3 className="text-sm font-bold text-slate-100">{currentStage || "Pipeline Running"}</h3>
                  </div>
                  {summary && (
                    <button
                      onClick={() => setActiveTab("review")}
                      className="px-4 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-lg shadow"
                    >
                      View Review Results →
                    </button>
                  )}
                </div>

                <div className="bg-slate-950 rounded-xl p-4 font-mono text-xs text-slate-300 max-h-48 overflow-y-auto space-y-1.5 border border-slate-800">
                  {progressLogs.map((log, i) => (
                    <div
                      key={i}
                      className={
                        log.startsWith("✓")
                          ? "text-emerald-400 font-semibold"
                          : log.startsWith("✗")
                          ? "text-red-400 font-semibold"
                          : "text-slate-400"
                      }
                    >
                      {log}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: CATEGORY MANAGER */}
        {activeTab === "categories" && (
          <div className="space-y-6 animate-fade-in">
            <div className="flex flex-wrap justify-between items-center gap-4 bg-slate-900/60 p-6 rounded-2xl border border-slate-800">
              <div>
                <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                  <span>🏷️</span> Classification Taxonomy & Categories
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Customize the categories TidyFlow sorts your files into. Add custom topics, delete unused categories, or edit keywords.
                </p>
              </div>

              <button
                onClick={() => setIsAddingCategory(true)}
                className="px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-indigo-600/30 flex items-center gap-2 transition"
              >
                <span>➕</span> Add New Category
              </button>
            </div>

            {/* Add Category Modal / Inline Form */}
            {isAddingCategory && (
              <div className="bg-slate-900 border border-indigo-500/40 p-6 rounded-2xl shadow-2xl space-y-4 animate-fade-in">
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-bold text-indigo-300">Create New Classification Category</h3>
                  <button onClick={() => setIsAddingCategory(false)} className="text-slate-400 hover:text-slate-200">
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Category Path (e.g. Work/Client_Alpha or Finance/Cryptocurrency)
                    </label>
                    <input
                      type="text"
                      value={newCatName}
                      onChange={(e) => setNewCatName(e.target.value)}
                      placeholder="Topic/Subtopic"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Description (Helps the AI understand what belongs here)
                    </label>
                    <input
                      type="text"
                      value={newCatDesc}
                      onChange={(e) => setNewCatDesc(e.target.value)}
                      placeholder="Files related to client Alpha deliverables and invoices"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Keywords (comma-separated, for rapid heuristic scoring)
                    </label>
                    <input
                      type="text"
                      value={newCatKeywords}
                      onChange={(e) => setNewCatKeywords(e.target.value)}
                      placeholder="client, alpha, contract, deliverable"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">
                      Extensions (comma-separated)
                    </label>
                    <input
                      type="text"
                      value={newCatExtensions}
                      onChange={(e) => setNewCatExtensions(e.target.value)}
                      placeholder=".pdf, .docx, .xlsx"
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-100 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                    />
                  </div>
                </div>

                <div className="flex justify-end gap-3 pt-2">
                  <button
                    onClick={() => setIsAddingCategory(false)}
                    className="px-4 py-2 text-xs font-semibold text-slate-400 hover:text-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleAddCategory}
                    className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-lg shadow"
                  >
                    Save Category
                  </button>
                </div>
              </div>
            )}

            {/* Category Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {Object.entries(categories).map(([name, cat]) => (
                <div
                  key={name}
                  className={`p-5 rounded-2xl border transition-all duration-200 ${
                    cat.active
                      ? "bg-slate-900/80 border-slate-800 hover:border-indigo-500/40 shadow-lg"
                      : "bg-slate-950/60 border-slate-900 opacity-60"
                  }`}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={cat.active}
                        onChange={() => handleToggleCategory(name)}
                        className="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-slate-700 focus:ring-indigo-500 cursor-pointer"
                      />
                      <span className="font-bold text-sm text-slate-100 font-mono">{name}</span>
                    </div>

                    <button
                      onClick={() => handleDeleteCategory(name)}
                      title="Delete Category"
                      className="text-slate-500 hover:text-red-400 text-xs p-1 rounded transition"
                    >
                      🗑️
                    </button>
                  </div>

                  <p className="text-xs text-slate-400 mt-2 line-clamp-2">{cat.description || "No description"}</p>

                  {cat.keywords && cat.keywords.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-1">
                      {cat.keywords.slice(0, 5).map((kw, i) => (
                        <span key={i} className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded-md font-mono">
                          {kw}
                        </span>
                      ))}
                      {cat.keywords.length > 5 && (
                        <span className="text-[10px] text-slate-500">+{cat.keywords.length - 5}</span>
                      )}
                    </div>
                  )}

                  {cat.extensions && cat.extensions.length > 0 && (
                    <div className="mt-2 text-[10px] text-slate-500 font-mono">
                      Ext: {cat.extensions.join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TAB 3: REVIEW & APPLY (Direct in-UI actions without manual CSV export!) */}
        {activeTab === "review" && (
          <div className="space-y-6 animate-fade-in">
            {/* Top Summary Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow">
                <p className="text-xs text-slate-400 font-medium">Total Files</p>
                <p className="text-2xl font-bold text-slate-100 mt-1">{files.length}</p>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow">
                <p className="text-xs text-emerald-400 font-medium">Selected for Organizing</p>
                <p className="text-2xl font-bold text-emerald-400 mt-1">{selectedFileIds.size}</p>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow">
                <p className="text-xs text-indigo-400 font-medium">High Confidence (&ge;85%)</p>
                <p className="text-2xl font-bold text-indigo-400 mt-1">
                  {files.filter((f) => f.confidence >= autoThreshold).length}
                </p>
              </div>

              <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 shadow">
                <p className="text-xs text-amber-400 font-medium">Manual Review Needed</p>
                <p className="text-2xl font-bold text-amber-400 mt-1">
                  {files.filter((f) => f.confidence < autoThreshold).length}
                </p>
              </div>
            </div>

            {/* Filter & Selection Control Bar */}
            <div className="bg-slate-900/80 p-4 rounded-2xl border border-slate-800 flex flex-wrap items-center justify-between gap-4 shadow-lg">
              <div className="flex flex-wrap items-center gap-3 flex-1">
                {/* Search Bar */}
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Filter by name, category, or content..."
                    className="w-full bg-slate-950 border border-slate-700/80 rounded-xl px-3.5 py-2 text-xs text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery("")}
                      className="absolute right-3 top-2 text-slate-500 hover:text-slate-300 text-xs"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* Category Filter */}
                <select
                  value={filterCategory}
                  onChange={(e) => setFilterCategory(e.target.value)}
                  className="bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500 font-mono"
                >
                  <option value="all">All Categories ({files.length})</option>
                  {uniqueCategories.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>

                {/* Confidence Filter */}
                <select
                  value={filterConfidence}
                  onChange={(e) => setFilterConfidence(e.target.value as any)}
                  className="bg-slate-950 border border-slate-700/80 rounded-xl px-3 py-2 text-xs text-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  <option value="all">All Confidence Scores</option>
                  <option value="high">High Confidence (&ge;85%)</option>
                  <option value="review">Needs Review (&lt;85%)</option>
                </select>
              </div>

              {/* Selection Buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={selectAllFiltered}
                  className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold rounded-lg border border-slate-700 transition"
                >
                  Select Filtered ({filteredFiles.length})
                </button>
                <button
                  onClick={deselectAllFiltered}
                  className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 rounded-lg border border-slate-700 transition"
                >
                  Clear
                </button>
              </div>
            </div>

            {/* Files List Table */}
            {filteredFiles.length === 0 ? (
              <div className="bg-slate-900/60 p-12 rounded-2xl border border-slate-800 text-center space-y-3">
                <p className="text-4xl">📂</p>
                <h3 className="text-base font-bold text-slate-300">No files match the selected filter</h3>
                <p className="text-xs text-slate-500">
                  {files.length === 0 ? "Run the pipeline from the 'Organize Folder' tab first." : "Try clearing your search query or category filters."}
                </p>
              </div>
            ) : (
              <div className="bg-slate-900/80 rounded-2xl border border-slate-800 overflow-hidden shadow-2xl">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400 font-semibold">
                        <th className="p-3.5 w-10 text-center">
                          <input
                            type="checkbox"
                            checked={filteredFiles.length > 0 && filteredFiles.every((f) => selectedFileIds.has(f.file_id))}
                            onChange={(e) => {
                              if (e.target.checked) selectAllFiltered();
                              else deselectAllFiltered();
                            }}
                            className="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-slate-700 focus:ring-indigo-500 cursor-pointer"
                          />
                        </th>
                        <th className="p-3.5">File Preview & Name</th>
                        <th className="p-3.5">Size</th>
                        <th className="p-3.5">Predicted / Override Category</th>
                        <th className="p-3.5">Confidence</th>
                        <th className="p-3.5">AI Reason & Details</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {filteredFiles.map((file) => {
                        const isSelected = selectedFileIds.has(file.file_id);
                        const currentCat = categoryOverrides[file.file_id] || file.category;
                        const isConfidenceHigh = file.confidence >= autoThreshold;

                        return (
                          <tr
                            key={file.file_id}
                            className={`transition-colors hover:bg-slate-800/40 ${
                              isSelected ? "bg-indigo-950/20" : ""
                            }`}
                          >
                            {/* Checkbox */}
                            <td className="p-3.5 text-center">
                              <input
                                type="checkbox"
                                checked={isSelected}
                                onChange={() => toggleSelectFile(file.file_id)}
                                className="w-4 h-4 rounded text-indigo-600 bg-slate-950 border-slate-700 focus:ring-indigo-500 cursor-pointer"
                              />
                            </td>

                            {/* Thumbnail & File Name */}
                            <td className="p-3.5">
                              <div className="flex items-center gap-3">
                                {file.thumbnail_b64 ? (
                                  <img
                                    src={`data:image/jpeg;base64,${file.thumbnail_b64}`}
                                    alt="thumbnail"
                                    className="w-10 h-10 object-cover rounded-lg border border-slate-700 shadow-sm"
                                  />
                                ) : (
                                  <div className="w-10 h-10 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-400 font-mono text-[10px] uppercase">
                                    {file.extension.replace(".", "") || "file"}
                                  </div>
                                )}
                                <div>
                                  <p className="font-semibold text-slate-200 font-mono text-xs">{file.filename}</p>
                                  {file.suggested_filename && file.suggested_filename !== file.filename && (
                                    <p className="text-[11px] text-indigo-300 font-mono">
                                      ↳ Suggested: {file.suggested_filename}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>

                            {/* Size */}
                            <td className="p-3.5 text-slate-400 font-mono text-[11px]">
                              {formatBytes(file.file_size_bytes)}
                            </td>

                            {/* Category Dropdown (Allows direct in-UI override!) */}
                            <td className="p-3.5">
                              <select
                                value={currentCat}
                                onChange={(e) => {
                                  setCategoryOverrides((prev) => ({
                                    ...prev,
                                    [file.file_id]: e.target.value,
                                  }));
                                }}
                                className="bg-slate-950 border border-slate-700 rounded-lg px-2.5 py-1 text-xs text-indigo-300 font-mono font-medium outline-none focus:ring-2 focus:ring-indigo-500"
                              >
                                {Object.keys(categories).map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                                {!categories[currentCat] && (
                                  <option value={currentCat}>{currentCat}</option>
                                )}
                              </select>
                            </td>

                            {/* Confidence Score Badge */}
                            <td className="p-3.5">
                              <div className="flex items-center gap-2">
                                <div className="w-12 bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${
                                      isConfidenceHigh ? "bg-emerald-400" : "bg-amber-400"
                                    }`}
                                    style={{ width: `${Math.round(file.confidence * 100)}%` }}
                                  />
                                </div>
                                <span
                                  className={`px-2 py-0.5 rounded-md text-[11px] font-bold ${
                                    isConfidenceHigh
                                      ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                      : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                  }`}
                                >
                                  {Math.round(file.confidence * 100)}%
                                </span>
                              </div>
                            </td>

                            {/* AI Reason & Text snippet */}
                            <td className="p-3.5 max-w-xs">
                              <p className="text-slate-300 text-xs line-clamp-2">{file.reason || "Rule-based match"}</p>
                              {file.near_duplicate_group_id && (
                                <span className="inline-block mt-1 text-[10px] text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                                  ⚠️ Near-duplicate #{file.near_duplicate_group_id}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Bottom Sticky Action Bar (One-Click Apply - NO CSV REQUIRED!) */}
            <div className="sticky bottom-4 z-30 bg-slate-900/95 backdrop-blur-md border border-slate-700/80 rounded-2xl p-4 shadow-2xl flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <span className="text-xs font-semibold text-slate-200">
                  Ready to organize <strong className="text-indigo-400">{selectedFileIds.size}</strong> of {files.length} files
                </span>

                <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={moveMode}
                    onChange={(e) => setMoveMode(e.target.checked)}
                    className="w-4 h-4 rounded text-red-500 bg-slate-950 border-slate-700 focus:ring-red-500"
                  />
                  <span>Move Mode (Default is Safe Copy)</span>
                </label>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleApplyDecisions}
                  disabled={isApplying || selectedFileIds.size === 0}
                  className={`px-8 py-3 rounded-xl font-bold text-xs flex items-center gap-2 shadow-xl transition-all transform active:scale-95 ${
                    isApplying || selectedFileIds.size === 0
                      ? "bg-slate-800 text-slate-500 cursor-not-allowed border border-slate-700"
                      : "bg-gradient-to-r from-emerald-600 via-teal-600 to-indigo-600 hover:from-emerald-500 hover:to-indigo-500 text-white shadow-emerald-500/25"
                  }`}
                >
                  {isApplying ? (
                    <>
                      <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span>Organizing Files...</span>
                    </>
                  ) : (
                    <>
                      <span>⚡</span>
                      <span>Apply & Organize Selected Files Now</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Success Modal */}
            {applyResultModal && (
              <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                <div className="bg-slate-900 border border-emerald-500/40 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4 animate-fade-in text-center">
                  <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 mx-auto flex items-center justify-center text-3xl">
                    ✓
                  </div>
                  <h3 className="text-lg font-bold text-slate-100">Files Successfully Organized!</h3>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    <strong>{applyResultModal.count} files</strong> have been {applyResultModal.action} into category folders under:
                  </p>
                  <p className="text-xs font-mono bg-slate-950 p-2.5 rounded-lg text-emerald-300 break-all border border-slate-800">
                    {applyResultModal.output_dir}
                  </p>
                  <button
                    onClick={() => setApplyResultModal(null)}
                    className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-lg transition"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SEARCH INDEX (FTS5) */}
        {activeTab === "search" && (
          <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
            <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 space-y-4">
              <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                <span>🔍</span> Full-Text SQLite FTS5 Search Index
              </h2>
              <p className="text-xs text-slate-400">
                Search across all extracted document text, OCR transcriptions, and metadata indexed by TidyFlow.
              </p>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={ftsQuery}
                  onChange={(e) => setFtsQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleFtsSearch()}
                  placeholder="Enter keywords (e.g. invoice, total amount, student fee, React, resume)..."
                  className="flex-1 bg-slate-950 border border-slate-700 rounded-xl px-4 py-3 text-xs text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
                />
                <button
                  onClick={handleFtsSearch}
                  disabled={isSearchingFts}
                  className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow"
                >
                  {isSearchingFts ? "Searching..." : "Search"}
                </button>
              </div>
            </div>

            {ftsResults.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                  Results ({ftsResults.length})
                </h3>
                {ftsResults.map((res: any, idx: number) => (
                  <div key={idx} className="bg-slate-900/80 p-4 rounded-xl border border-slate-800 space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-mono font-bold text-xs text-indigo-300">{res.path}</span>
                      <span className="text-[10px] bg-slate-800 text-slate-400 px-2 py-0.5 rounded font-mono">
                        {res.category || "Uncategorized"}
                      </span>
                    </div>
                    {res.extracted_text && (
                      <p className="text-xs text-slate-400 font-mono line-clamp-3 bg-slate-950/50 p-2 rounded">
                        {res.extracted_text}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* TAB 5: SETTINGS */}
        {activeTab === "settings" && (
          <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
            <div className="bg-slate-900/60 p-6 rounded-2xl border border-slate-800 space-y-5">
              <h2 className="text-xl font-bold text-slate-100 flex items-center gap-2">
                <span>⚙️</span> LLM Credentials & Preferences
              </h2>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">LLM Provider</label>
                  <select
                    value={llmProvider}
                    onChange={(e) => setLlmProvider(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-100 outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    <option value="deepseek">DeepSeek (deepseek-chat) - Recommended</option>
                    <option value="openai">OpenAI (gpt-4o / gpt-4o-mini)</option>
                    <option value="groq">Groq (llama-3.3-70b-versatile)</option>
                    <option value="openrouter">OpenRouter (Multi-model)</option>
                    <option value="gemini">Google Gemini</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1">
                    API Key {maskedKey && <span className="text-slate-500 font-normal">({maskedKey})</span>}
                  </label>
                  <input
                    type="password"
                    value={apiKeyInput}
                    onChange={(e) => setApiKeyInput(e.target.value)}
                    placeholder="Enter or update API key..."
                    className="w-full bg-slate-950 border border-slate-700 rounded-xl p-3 text-xs text-slate-100 font-mono outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                  <p className="text-[11px] text-slate-500 mt-1">
                    Credentials are securely stored in your OS Keyring and local `.env`.
                  </p>
                </div>

                <div>
                  <div className="flex justify-between items-center mb-1">
                    <label className="text-xs font-semibold text-slate-300">Auto-Approval Confidence Threshold</label>
                    <span className="text-xs font-mono font-bold text-indigo-400">{Math.round(autoThreshold * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="1.0"
                    step="0.05"
                    value={autoThreshold}
                    onChange={(e) => setAutoThreshold(parseFloat(e.target.value))}
                    className="w-full accent-indigo-500 cursor-pointer"
                  />
                </div>

                {saveSettingsSuccess && (
                  <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs p-3 rounded-xl font-semibold">
                    ✓ Settings saved successfully!
                  </div>
                )}

                <button
                  onClick={handleSaveSettings}
                  className="w-full py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs rounded-xl shadow-lg transition"
                >
                  Save Configuration
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
