import { useState, useEffect } from "react";
import {
  CategoryItem,
  ClassifiedFile,
  RunSummary,
  ApplyDecisionItem,
  FtsResultItem,
  TabType,
  BackendStatus,
  ComplexityLevel,
} from "./types";
import { Navbar } from "./components/Navbar";
import { GetStartedView } from "./components/GetStartedView";
import { FolderSelectView } from "./components/FolderSelectView";
import { OrganizeView } from "./components/OrganizeView";
import { ReviewView } from "./components/ReviewView";
import { SearchView } from "./components/SearchView";
import { SettingsView } from "./components/SettingsView";
import { DirectoryPickerModal } from "./components/DirectoryPickerModal";
import { ResetWorkspaceModal } from "./components/ResetWorkspaceModal";
import { API_BASE } from "./config";
import "./App.css";

export default function App() {
  const [settingsSubTab, setSettingsSubTab] = useState<"general" | "categories">("general");

  const [activeTab, setActiveTabState] = useState<TabType>(() => {
    const hasOnboarded = localStorage.getItem("tidyflow_has_onboarded");
    if (!hasOnboarded) return "welcome";
    const savedTab = localStorage.getItem("tidyflow_active_tab") as TabType;
    if (savedTab === "categories") return "settings";
    if (savedTab) return savedTab;
    const savedFolder = localStorage.getItem("tidyflow_input_folder");
    return savedFolder ? "organize" : "select_folder";
  });

  const setActiveTab = (tab: TabType) => {
    if (tab === "categories") {
      setSettingsSubTab("categories");
      setActiveTabState("settings");
      localStorage.setItem("tidyflow_active_tab", "settings");
      return;
    }
    setActiveTabState(tab);
    localStorage.setItem("tidyflow_active_tab", tab);
  };

  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [hasLlmKey, setHasLlmKey] = useState(false);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerTarget, setFolderPickerTarget] = useState<"source" | "destination">("source");
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);

  // Dark mode theme state
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem("tidyflow_theme");
    if (saved) return saved === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  });

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add("dark");
      localStorage.setItem("tidyflow_theme", "dark");
    } else {
      document.documentElement.classList.remove("dark");
      localStorage.setItem("tidyflow_theme", "light");
    }
  }, [darkMode]);

  const toggleDarkMode = () => setDarkMode((prev) => !prev);

  // Organize tab state — restored from localStorage or fetched from quick locations
  const [inputFolder, setInputFolderState] = useState<string>(() => {
    return localStorage.getItem("tidyflow_input_folder") || "";
  });
  const [outputFolder, setOutputFolderState] = useState<string>(() => {
    return localStorage.getItem("tidyflow_output_folder") || "";
  });

  const setInputFolder = (path: string) => {
    setInputFolderState(path);
    if (path) localStorage.setItem("tidyflow_input_folder", path);
    else localStorage.removeItem("tidyflow_input_folder");
  };

  const setOutputFolder = (path: string) => {
    setOutputFolderState(path);
    if (path) localStorage.setItem("tidyflow_output_folder", path);
    else localStorage.removeItem("tidyflow_output_folder");
  };

  const [useLlm, setUseLlm] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>("");
  const [progressLogs, setProgressLogs] = useState<string[]>([]);

  // Categories state
  const [categories, setCategories] = useState<Record<string, CategoryItem>>({});
  const [customInstructions, setCustomInstructionsState] = useState<string>(() => {
    return localStorage.getItem("tidyflow_custom_instructions") || "";
  });
  const setCustomInstructions = (val: string) => {
    setCustomInstructionsState(val);
    localStorage.setItem("tidyflow_custom_instructions", val);
  };

  const [complexityLevel, setComplexityLevelState] = useState<ComplexityLevel>(() => {
    const saved = localStorage.getItem("tidyflow_complexity_level");
    if (saved === "low" || saved === "medium" || saved === "high") return saved;
    if (saved === "complex") return "high";
    return "medium";
  });
  const setComplexityLevel = (lvl: ComplexityLevel) => {
    setComplexityLevelState(lvl);
    localStorage.setItem("tidyflow_complexity_level", lvl);
  };

  // Review & Apply state — persistent across tab changes and page reloads
  const [files, setFilesState] = useState<ClassifiedFile[]>(() => {
    try {
      const saved = localStorage.getItem("tidyflow_cached_files");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });
  const setFiles = (newFiles: ClassifiedFile[] | ((prev: ClassifiedFile[]) => ClassifiedFile[])) => {
    setFilesState((prev) => {
      const next = typeof newFiles === "function" ? newFiles(prev) : newFiles;
      try {
        localStorage.setItem("tidyflow_cached_files", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const [summary, setSummaryState] = useState<RunSummary | null>(() => {
    try {
      const saved = localStorage.getItem("tidyflow_cached_summary");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });
  const setSummary = (s: RunSummary | null | ((prev: RunSummary | null) => RunSummary | null)) => {
    setSummaryState((prev) => {
      const next = typeof s === "function" ? s(prev) : s;
      try {
        if (next) localStorage.setItem("tidyflow_cached_summary", JSON.stringify(next));
        else localStorage.removeItem("tidyflow_cached_summary");
      } catch {}
      return next;
    });
  };

  const [selectedFileIds, setSelectedFileIdsState] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("tidyflow_selected_files");
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch {
      return new Set();
    }
  });
  const setSelectedFileIds: React.Dispatch<React.SetStateAction<Set<string>>> = (val) => {
    setSelectedFileIdsState((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      try {
        localStorage.setItem("tidyflow_selected_files", JSON.stringify(Array.from(next)));
      } catch {}
      return next;
    });
  };

  const [categoryOverrides, setCategoryOverridesState] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem("tidyflow_category_overrides");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const setCategoryOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>> = (val) => {
    setCategoryOverridesState((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      try {
        localStorage.setItem("tidyflow_category_overrides", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const [filenameOverrides, setFilenameOverridesState] = useState<Record<string, string>>(() => {
    try {
      const saved = localStorage.getItem("tidyflow_filename_overrides");
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });
  const setFilenameOverrides: React.Dispatch<React.SetStateAction<Record<string, string>>> = (val) => {
    setFilenameOverridesState((prev) => {
      const next = typeof val === "function" ? val(prev) : val;
      try {
        localStorage.setItem("tidyflow_filename_overrides", JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const [moveMode, setMoveMode] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [applyResultModal, setApplyResultModal] = useState<{
    count: number;
    action: string;
    output_dir: string;
  } | null>(null);

  // Search tab state
  const [ftsQuery, setFtsQuery] = useState("");
  const [ftsResults, setFtsResults] = useState<FtsResultItem[]>([]);
  const [isSearchingFts, setIsSearchingFts] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // Settings state
  const [llmProvider, setLlmProvider] = useState("deepseek");
  const [selectedModel, setSelectedModel] = useState("deepseek-v4-flash");
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
        if (data.categories && Object.keys(data.categories).length > 0) {
          setCategories(data.categories);
        }
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
        setSelectedModel(data.model || "deepseek-chat");
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
            if (
              f.confidence >= autoThreshold &&
              f.category !== "Unknown" &&
              f.action === "copy_to_organized"
            ) {
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

    // If no folder stored in localStorage, set default from system locations
    if (!inputFolder) {
      fetch(`${API_BASE}/fs/quick-locations`)
        .then((res) => res.json())
        .then((data) => {
          if (data.locations && data.locations.length > 0) {
            const downloads = data.locations.find((l: any) => l.name === "Downloads");
            const defPath = downloads ? downloads.path : data.locations[0].path;
            setInputFolder(defPath);
            setOutputFolder(`${defPath}/Organized_Output`);
          }
        })
        .catch((err) => console.error("Could not fetch default location:", err));
    }

    const interval = setInterval(checkStatus, 6000);
    return () => clearInterval(interval);
  }, []);

  // Connect SSE for real-time progress updates
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API_BASE}/events`);
      es.addEventListener("pipeline_progress", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.stage) {
            setCurrentStage(payload.stage);
          }
          if (payload.message) {
            setProgressLogs((prev) => [...prev, `> ${payload.message}`]);
          }
        } catch {}
      });
      es.addEventListener("pipeline_error", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.error) {
            setProgressLogs((prev) => [...prev, `✗ Error: ${payload.error}`]);
          }
        } catch {}
      });
      es.addEventListener("pipeline_cancelled", () => {
        setIsRunning(false);
        setIsCancelling(false);
        setCurrentStage("Cancelled");
        setProgressLogs((prev) => [...prev, "🛑 Pipeline was safely cancelled."]);
      });
    } catch (e) {
      console.warn("EventSource setup error:", e);
    }
    return () => {
      es?.close();
    };
  }, []);

  const handleCancelPipeline = async () => {
    setIsCancelling(true);
    setProgressLogs((prev) => [...prev, "🛑 Halting active pipeline execution..."]);
    try {
      await fetch(`${API_BASE}/pipeline/cancel`, { method: "POST" });
    } catch (e) {
      console.warn("Pipeline cancel request failed:", e);
    } finally {
      setTimeout(() => {
        setIsRunning(false);
        setIsCancelling(false);
        setCurrentStage("Cancelled");
        setProgressLogs((prev) => [...prev, "✓ Organization safely halted. No files were modified."]);
      }, 500);
    }
  };

  // --- Category Actions ---

  const handleToggleCategory = async (catName: string) => {
    const existing = categories[catName];
    if (!existing) return;

    const updated = {
      ...categories,
      [catName]: { ...existing, active: !existing.active },
    };
    setCategories(updated);

    try {
      await fetch(`${API_BASE}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: updated }),
      });
    } catch (e) {
      console.error("Failed to update category state:", e);
    }
  };

  const handleAddCategory = async (newCat: {
    name: string;
    description: string;
    keywords: string[];
    extensions: string[];
  }) => {
    const updated = {
      ...categories,
      [newCat.name]: {
        name: newCat.name,
        description: newCat.description,
        keywords: newCat.keywords,
        extensions: newCat.extensions,
        active: true,
      },
    };

    setCategories(updated);

    try {
      await fetch(`${API_BASE}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: updated }),
      });
    } catch (e) {
      console.error("Failed to save category:", e);
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

  const handleLoadPreset = async (presetCats: Record<string, CategoryItem>) => {
    setCategories(presetCats);
    try {
      await fetch(`${API_BASE}/categories`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categories: presetCats }),
      });
    } catch (e) {
      console.error("Failed to save preset categories:", e);
    }
  };

  // --- Pipeline Execution ---

  const handleStartPipeline = async (
    customCats?: Record<string, CategoryItem>,
    instructions?: string,
    complexity?: ComplexityLevel
  ) => {
    if (!inputFolder.trim()) return;
    setIsRunning(true);
    setCurrentStage("scan");
    setProgressLogs([`> Initiating scan on ${inputFolder}`]);

    const catsToUse = customCats || categories;
    const instructionsToUse = instructions !== undefined ? instructions : customInstructions;
    const levelToUse = complexity || complexityLevel || "medium";

    const activeCats: Record<string, any> = {};
    Object.entries(catsToUse).forEach(([name, item]) => {
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
          custom_instructions: instructionsToUse.trim() || undefined,
          complexity_level: levelToUse,
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
      setCategoryOverrides({});
      if (data.output_dir) setOutputFolder(data.output_dir);

      // Auto-select high confidence files matching active categories
      const preselected = new Set<string>();
      (data.files || []).forEach((f: ClassifiedFile) => {
        const isCustomMatch =
          Object.keys(activeCats).length === 0 || activeCats[f.category] !== undefined;
        if (
          f.confidence >= autoThreshold &&
          f.category !== "Unknown" &&
          f.action === "copy_to_organized" &&
          isCustomMatch
        ) {
          preselected.add(f.file_id);
        }
      });
      setSelectedFileIds(preselected);

      setCurrentStage("finalize");
      setProgressLogs((prev) => [
        ...prev,
        `✓ Prepared ${data.files?.length || 0} classified files!`,
      ]);

      // Automatically transition to the Review tab
      setTimeout(() => {
        setIsRunning(false);
        setActiveTab("review");
      }, 750);
    } catch (err: any) {
      setProgressLogs((prev) => [...prev, `✗ Error: ${err.message}`]);
      setCurrentStage("error");
      setTimeout(() => setIsRunning(false), 2000);
    }
  };

  // --- Apply Decisions ---

  const handleApplyDecisions = async () => {
    if (selectedFileIds.size === 0) {
      alert("Please select at least one file to organize.");
      return;
    }

    setIsApplying(true);
    const decisionList: ApplyDecisionItem[] = [];

    files.forEach((f) => {
      const isApproved = selectedFileIds.has(f.file_id);
      const overrideCat = categoryOverrides[f.file_id];
      const targetName = filenameOverrides[f.file_id] || undefined;
      decisionList.push({
        file_id: f.file_id,
        approved: isApproved,
        override_category: overrideCat || undefined,
        target_filename: targetName,
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
          model: selectedModel,
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

  // --- FTS Search ---

  const handleFtsSearch = async (queryOverride?: string) => {
    const q = (queryOverride !== undefined ? queryOverride : ftsQuery).trim();
    if (!q) return;
    if (queryOverride !== undefined) {
      setFtsQuery(queryOverride);
    }
    setIsSearchingFts(true);
    setHasSearched(true);
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`);
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

  const handleClearFts = () => {
    setFtsQuery("");
    setFtsResults([]);
    setHasSearched(false);
  };

  const handleSelectFolder = (path: string) => {
    if (path !== inputFolder) {
      setInputFolder(path);
      setOutputFolder(`${path}/Organized_Output`);
      setCategories({});
      setCustomInstructions("");
      setFiles([]);
      setSummary(null);
      setSelectedFileIds(new Set());
      setCategoryOverrides({});
      setFilenameOverrides({});
      setProgressLogs([]);
      setCurrentStage("");
      localStorage.removeItem("tidyflow_cached_files");
      localStorage.removeItem("tidyflow_cached_summary");
      localStorage.removeItem("tidyflow_selected_files");
      localStorage.removeItem("tidyflow_category_overrides");
      localStorage.removeItem("tidyflow_filename_overrides");
      localStorage.removeItem("tidyflow_custom_instructions");
    }
  };

  const handleOpenPath = async (path: string) => {
    try {
      await fetch(`${API_BASE}/fs/open-path`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, reveal: true }),
      });
    } catch (err) {
      console.error("Failed to open path:", err);
    }
  };

  const handleConfirmResetWorkspace = () => {
    setInputFolderState("");
    setOutputFolderState("");
    localStorage.removeItem("tidyflow_input_folder");
    localStorage.removeItem("tidyflow_output_folder");
    localStorage.removeItem("tidyflow_cached_files");
    localStorage.removeItem("tidyflow_cached_summary");
    localStorage.removeItem("tidyflow_selected_files");
    localStorage.removeItem("tidyflow_category_overrides");
    localStorage.removeItem("tidyflow_filename_overrides");
    localStorage.removeItem("tidyflow_custom_instructions");
    localStorage.removeItem("tidyflow_complexity_level");
    setCategories({});
    setCustomInstructions("");
    setFiles([]);
    setSummary(null);
    setSelectedFileIds(new Set());
    setCategoryOverrides({});
    setFilenameOverrides({});
    setProgressLogs([]);
    setCurrentStage("");
    setComplexityLevel("medium");
    setActiveTab("select_folder");
  };

  return (
    <div className="min-h-screen bg-[#f6f5f4] dark:bg-[#191919] text-[#000000] dark:text-[#ededed] flex flex-col font-sans selection:bg-[#0075de]/20 selection:text-[#005bab] transition-colors duration-200">
      {/* Top Navigation Bar with Dark Mode Switch & Reset Workspace */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        backendStatus={backendStatus}
        hasLlmKey={hasLlmKey}
        fileCount={files.length}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
        onResetWorkspace={() => setIsResetModalOpen(true)}
      />

      {/* Reset Workspace Confirmation Modal */}
      <ResetWorkspaceModal
        isOpen={isResetModalOpen}
        onClose={() => setIsResetModalOpen(false)}
        onConfirm={handleConfirmResetWorkspace}
        inputFolder={inputFolder}
        categoryCount={Object.keys(categories).length}
        fileCount={files.length}
      />

      {/* Directory Picker Modal for In-App Folder Browsing */}
      <DirectoryPickerModal
        isOpen={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        onSelect={(path) => {
          setFolderPickerOpen(false);
          if (folderPickerTarget === "source") {
            handleSelectFolder(path);
          } else {
            setOutputFolder(path);
          }
        }}
        initialPath={folderPickerTarget === "source" ? inputFolder : outputFolder}
        title={folderPickerTarget === "source" ? "Select Folder to Organize" : "Select Destination Folder"}
        description={
          folderPickerTarget === "source"
            ? "Choose the cluttered folder you want TidyFlow to scan and file."
            : "Choose where organized category folders should be created."
        }
      />

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
        {activeTab === "welcome" && (
          <GetStartedView
            onGetStarted={() => {
              localStorage.setItem("tidyflow_has_onboarded", "true");
              setActiveTab("select_folder");
            }}
            recentFolder={inputFolder}
            recentSummary={summary}
            outputFolder={outputFolder}
            onResumeRecent={() => {
              localStorage.setItem("tidyflow_has_onboarded", "true");
              setActiveTab("organize");
            }}
            onOpenOutputFolder={handleOpenPath}
          />
        )}

        {activeTab === "select_folder" && (
          <FolderSelectView
            inputFolder={inputFolder}
            setInputFolder={handleSelectFolder}
            outputFolder={outputFolder}
            setOutputFolder={setOutputFolder}
            onContinue={() => setActiveTab("organize")}
            onBack={() => setActiveTab("welcome")}
            onOpenDirectoryPicker={(target) => {
              setFolderPickerTarget(target);
              setFolderPickerOpen(true);
            }}
            fileCount={files.length}
            onNavigateToReview={() => setActiveTab("review")}
          />
        )}

        {activeTab === "organize" && (
          <OrganizeView
            inputFolder={inputFolder}
            setInputFolder={handleSelectFolder}
            outputFolder={outputFolder}
            setOutputFolder={setOutputFolder}
            useLlm={useLlm}
            setUseLlm={setUseLlm}
            isRunning={isRunning}
            currentStage={currentStage}
            progressLogs={progressLogs}
            categories={categories}
            setCategories={setCategories}
            customInstructions={customInstructions}
            setCustomInstructions={setCustomInstructions}
            summary={summary}
            backendStatus={backendStatus}
            onStartPipeline={handleStartPipeline}
            onNavigateToReview={() => setActiveTab("review")}
            onNavigateToCategories={() => {
              setSettingsSubTab("categories");
              setActiveTab("settings");
            }}
            onChangeFolder={() => setActiveTab("select_folder")}
            fileCount={files.length}
            complexityLevel={complexityLevel}
            setComplexityLevel={setComplexityLevel}
            onCancelPipeline={handleCancelPipeline}
            isCancelling={isCancelling}
          />
        )}

        {activeTab === "review" && (
          <ReviewView
            files={files}
            categories={categories}
            setCategories={setCategories}
            summary={summary}
            selectedFileIds={selectedFileIds}
            setSelectedFileIds={setSelectedFileIds}
            categoryOverrides={categoryOverrides}
            setCategoryOverrides={setCategoryOverrides}
            filenameOverrides={filenameOverrides}
            setFilenameOverrides={setFilenameOverrides}
            autoThreshold={autoThreshold}
            outputFolder={outputFolder}
            moveMode={moveMode}
            setMoveMode={setMoveMode}
            isApplying={isApplying}
            applyResultModal={applyResultModal}
            setApplyResultModal={setApplyResultModal}
            onApplyDecisions={handleApplyDecisions}
            onNavigateToOrganize={() => setActiveTab("organize")}
            inputFolder={inputFolder}
            onNavigateToSelectFolder={() => setActiveTab("select_folder")}
            onNavigateToSearch={() => setActiveTab("search")}
          />
        )}

        {activeTab === "search" && (
          <SearchView
            ftsQuery={ftsQuery}
            setFtsQuery={setFtsQuery}
            ftsResults={ftsResults}
            isSearching={isSearchingFts}
            hasSearched={hasSearched}
            onSearch={handleFtsSearch}
            onClear={handleClearFts}
          />
        )}

        {(activeTab === "settings" || activeTab === "categories") && (
          <SettingsView
            llmProvider={llmProvider}
            setLlmProvider={setLlmProvider}
            selectedModel={selectedModel}
            setSelectedModel={setSelectedModel}
            apiKeyInput={apiKeyInput}
            setApiKeyInput={setApiKeyInput}
            maskedKey={maskedKey}
            autoThreshold={autoThreshold}
            setAutoThreshold={setAutoThreshold}
            saveSuccess={saveSettingsSuccess}
            onSaveSettings={handleSaveSettings}
            subTab={settingsSubTab}
            setSubTab={setSettingsSubTab}
            categories={categories}
            onToggleCategory={handleToggleCategory}
            onAddCategory={handleAddCategory}
            onDeleteCategory={handleDeleteCategory}
            onLoadPreset={handleLoadPreset}
          />
        )}
      </main>
    </div>
  );
}
