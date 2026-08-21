import { useState, useEffect } from "react";
import {
  CategoryItem,
  ClassifiedFile,
  RunSummary,
  ApplyDecisionItem,
  FtsResultItem,
  TabType,
  BackendStatus,
} from "./types";
import { Navbar } from "./components/Navbar";
import { OrganizeView } from "./components/OrganizeView";
import { CategoriesView } from "./components/CategoriesView";
import { ReviewView } from "./components/ReviewView";
import { SearchView } from "./components/SearchView";
import { SettingsView } from "./components/SettingsView";
import "./App.css";

const API_BASE = "http://localhost:8000";

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>("organize");
  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [hasLlmKey, setHasLlmKey] = useState(false);

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
  };

  const setOutputFolder = (path: string) => {
    setOutputFolderState(path);
    if (path) localStorage.setItem("tidyflow_output_folder", path);
  };
  const [useLlm, setUseLlm] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>("");
  const [progressLogs, setProgressLogs] = useState<string[]>([]);

  // Categories state
  const [categories, setCategories] = useState<Record<string, CategoryItem>>({});
  const [customInstructions, setCustomInstructions] = useState("");

  // Review & Apply state
  const [files, setFiles] = useState<ClassifiedFile[]>([]);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set());
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, string>>({});
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

  // --- Pipeline Execution ---

  const handleStartPipeline = async (
    customCats?: Record<string, CategoryItem>,
    instructions?: string
  ) => {
    if (!inputFolder.trim()) return;
    setIsRunning(true);
    setCurrentStage("Scanning directory & computing content hashes...");
    setProgressLogs([`> Initiating scan on ${inputFolder}`]);

    const catsToUse = customCats || categories;
    const instructionsToUse = instructions !== undefined ? instructions : customInstructions;

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

      setCurrentStage("Classification Complete!");
      setProgressLogs((prev) => [
        ...prev,
        `✓ Processed ${data.files?.length || 0} files successfully!`,
      ]);

      // Automatically transition to the Review tab
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

  return (
    <div className="min-h-screen bg-[#f6f5f4] dark:bg-[#191919] text-[#000000] dark:text-[#ededed] flex flex-col font-sans selection:bg-[#0075de]/20 selection:text-[#005bab] transition-colors duration-200">
      {/* Top Navigation Bar with Dark Mode Switch */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        backendStatus={backendStatus}
        hasLlmKey={hasLlmKey}
        fileCount={files.length}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
      />

      {/* Main Workspace Body */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-6 md:p-8">
        {activeTab === "organize" && (
          <OrganizeView
            inputFolder={inputFolder}
            setInputFolder={setInputFolder}
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
            onNavigateToCategories={() => setActiveTab("categories")}
          />
        )}

        {activeTab === "categories" && (
          <CategoriesView
            categories={categories}
            onToggleCategory={handleToggleCategory}
            onAddCategory={handleAddCategory}
            onDeleteCategory={handleDeleteCategory}
          />
        )}

        {activeTab === "review" && (
          <ReviewView
            files={files}
            categories={categories}
            summary={summary}
            selectedFileIds={selectedFileIds}
            setSelectedFileIds={setSelectedFileIds}
            categoryOverrides={categoryOverrides}
            setCategoryOverrides={setCategoryOverrides}
            autoThreshold={autoThreshold}
            outputFolder={outputFolder}
            moveMode={moveMode}
            setMoveMode={setMoveMode}
            isApplying={isApplying}
            applyResultModal={applyResultModal}
            setApplyResultModal={setApplyResultModal}
            onApplyDecisions={handleApplyDecisions}
            onNavigateToOrganize={() => setActiveTab("organize")}
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

        {activeTab === "settings" && (
          <SettingsView
            llmProvider={llmProvider}
            setLlmProvider={setLlmProvider}
            apiKeyInput={apiKeyInput}
            setApiKeyInput={setApiKeyInput}
            maskedKey={maskedKey}
            autoThreshold={autoThreshold}
            setAutoThreshold={setAutoThreshold}
            saveSuccess={saveSettingsSuccess}
            onSaveSettings={handleSaveSettings}
          />
        )}
      </main>
    </div>
  );
}
