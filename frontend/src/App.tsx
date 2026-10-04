import { useState, useEffect, useMemo, useRef } from "react";
import { AnimatePresence } from "motion/react";
import {
  CategoryItem,
  ClassifiedFile,
  RunSummary,
  ApplyDecisionItem,
  FtsResultItem,
  BackendStatus,
  ComplexityLevel,
} from "./types";
import type { AppView, DoneResult, FlowStep, QuickLocation } from "./flow/contracts";
import { TopBar } from "./flow/TopBar";
import { HomeScreen } from "./flow/HomeScreen";
import { PlanScreen } from "./flow/PlanScreen";
import { SortingScreen } from "./flow/SortingScreen";
import { PreviewScreen } from "./flow/PreviewScreen";
import { DoneScreen } from "./flow/DoneScreen";
import { Screen } from "./flow/ui";
import { OrganizeView } from "./components/OrganizeView";
import { ReviewView } from "./components/ReviewView";
import { SearchView } from "./components/SearchView";
import { SettingsView } from "./components/SettingsView";
import { DirectoryPickerModal } from "./components/DirectoryPickerModal";
import { API_BASE } from "./config";
import "./App.css";

/** Read a JSON value from localStorage, falling back when missing or corrupt. */
function loadJson<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key);
    return saved ? (JSON.parse(saved) as T) : fallback;
  } catch {
    return fallback;
  }
}

function saveJson(key: string, value: unknown) {
  try {
    if (value === null || value === undefined) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** useState that mirrors its value into localStorage. */
function usePersistentState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => loadJson(key, fallback));
  const set: React.Dispatch<React.SetStateAction<T>> = (next) => {
    setValue((prev) => {
      const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
      saveJson(key, v);
      return v;
    });
  };
  return [value, set] as const;
}

/** Which folder plan and source folder a set of results was produced from. */
interface ResultMeta {
  inputDir: string;
  categories: string[];
}

function sameNames(a: string[], b: string[]) {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

function toCategoryItems(raw: Record<string, any>): Record<string, CategoryItem> {
  const out: Record<string, CategoryItem> = {};
  Object.entries(raw).forEach(([name, c]) => {
    if (name === "Unknown") return; // catch-all for unsorted files, not a real folder
    out[name] = {
      name: c?.name || name,
      description: c?.description || "",
      keywords: c?.keywords || [],
      extensions: c?.extensions || [],
      active: c?.active !== false,
    };
  });
  return out;
}

export default function App() {
  // --- Navigation ---
  const [view, setView] = usePersistentState<AppView>("tidyflow_view", "flow");
  const [step, setStepState] = usePersistentState<FlowStep>("tidyflow_step", "home");
  const setStep = (s: FlowStep) => {
    setStepState(s);
    setView("flow");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const [advancedMode, setAdvancedMode] = usePersistentState<boolean>("tidyflow_advanced_mode", false);

  const [backendStatus, setBackendStatus] = useState<BackendStatus>("checking");
  const [hasLlmKey, setHasLlmKey] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [folderPickerOpen, setFolderPickerOpen] = useState(false);
  const [folderPickerTarget, setFolderPickerTarget] = useState<"source" | "destination">("source");
  const [quickLocations, setQuickLocations] = useState<QuickLocation[]>([]);

  // --- Theme ---
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    const saved = localStorage.getItem("tidyflow_theme");
    if (saved) return saved === "dark";
    return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  });
  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
    localStorage.setItem("tidyflow_theme", darkMode ? "dark" : "light");
  }, [darkMode]);
  const toggleDarkMode = () => setDarkMode((prev) => !prev);

  // --- Folders ---
  const [inputFolder, setInputFolderState] = useState<string>(() => localStorage.getItem("tidyflow_input_folder") || "");
  const [outputFolder, setOutputFolderState] = useState<string>(() => localStorage.getItem("tidyflow_output_folder") || "");
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

  // --- Sorting run ---
  const [useLlm, setUseLlm] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [currentStage, setCurrentStage] = useState<string>("");
  const [progressLogs, setProgressLogs] = useState<string[]>([]);
  const [sortError, setSortError] = useState<string | null>(null);

  // --- Folder plan ---
  const [categories, setCategories] = useState<Record<string, CategoryItem>>({});
  const [categoriesLoaded, setCategoriesLoaded] = useState(false);
  const [customInstructions, setCustomInstructionsState] = useState<string>(
    () => localStorage.getItem("tidyflow_custom_instructions") || ""
  );
  const setCustomInstructions = (val: string) => {
    setCustomInstructionsState(val);
    localStorage.setItem("tidyflow_custom_instructions", val);
  };
  const [complexityLevel, setComplexityLevelState] = useState<ComplexityLevel>(() => {
    const saved = localStorage.getItem("tidyflow_complexity_level");
    if (saved === "low" || saved === "medium" || saved === "high") return saved;
    return "medium";
  });
  const setComplexityLevel = (lvl: ComplexityLevel) => {
    setComplexityLevelState(lvl);
    localStorage.setItem("tidyflow_complexity_level", lvl);
  };
  const [isGenerating, setIsGenerating] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [assistantNote, setAssistantNote] = useState<string | null>(null);
  // Folders that came from the no-AI fallback; offered for regeneration once AI works.
  const [planIsBasic, setPlanIsBasic] = usePersistentState<boolean>("tidyflow_plan_basic", false);
  const [planChat, setPlanChat] = useState<{ role: "user" | "assistant"; content: string }[]>([]);

  // --- Results ---
  const [files, setFiles] = usePersistentState<ClassifiedFile[]>("tidyflow_cached_files", []);
  const [summary, setSummary] = usePersistentState<RunSummary | null>("tidyflow_cached_summary", null);
  const [resultMeta, setResultMeta] = usePersistentState<ResultMeta | null>("tidyflow_result_meta", null);
  const [selectedIdList, setSelectedIdList] = usePersistentState<string[]>("tidyflow_selected_files", []);
  const selectedFileIds = useMemo(() => new Set(selectedIdList), [selectedIdList]);
  const setSelectedFileIds: React.Dispatch<React.SetStateAction<Set<string>>> = (val) => {
    setSelectedIdList((prev) => {
      const next = typeof val === "function" ? val(new Set(prev)) : val;
      return Array.from(next);
    });
  };
  const [categoryOverrides, setCategoryOverrides] = usePersistentState<Record<string, string>>(
    "tidyflow_category_overrides",
    {}
  );
  const [filenameOverrides, setFilenameOverrides] = usePersistentState<Record<string, string>>(
    "tidyflow_filename_overrides",
    {}
  );

  const [moveMode, setMoveMode] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [doneResult, setDoneResult] = usePersistentState<DoneResult | null>("tidyflow_done_result", null);
  const [undoState, setUndoState] = useState<"idle" | "working" | "done" | "error">("idle");
  const [undoMessage, setUndoMessage] = useState<string | null>(null);

  // --- Search ---
  const [ftsQuery, setFtsQuery] = useState("");
  const [ftsResults, setFtsResults] = useState<FtsResultItem[]>([]);
  const [isSearchingFts, setIsSearchingFts] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  // --- Settings ---
  const [llmProvider, setLlmProvider] = useState("deepseek");
  const [selectedModel, setSelectedModel] = useState("deepseek-v4-flash");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [autoThreshold, setAutoThreshold] = useState(0.85);
  const [maskedKey, setMaskedKey] = useState("");
  const [saveSettingsSuccess, setSaveSettingsSuccess] = useState(false);
  const [settingsSubTab, setSettingsSubTab] = useState<"general" | "categories">("general");

  // --- Derived ---
  const activeFolderNames = useMemo(
    () => Object.values(categories).filter((c) => c.active).map((c) => c.name),
    [categories]
  );
  const hasResults = files.length > 0;
  const resultsAreForThisFolder = hasResults && resultMeta?.inputDir === inputFolder;
  const isStale =
    hasResults && (!resultMeta || !resultsAreForThisFolder || !sameNames(resultMeta.categories, activeFolderNames));
  const renameSuggestions = useMemo(
    () => files.filter((f) => f.suggested_filename && f.suggested_filename !== f.filename),
    [files]
  );

  const reachableSteps: FlowStep[] = useMemo(() => {
    const steps: FlowStep[] = ["home"];
    if (inputFolder) steps.push("plan");
    if (hasResults && resultsAreForThisFolder) steps.push("preview");
    return steps;
  }, [inputFolder, hasResults, resultsAreForThisFolder]);

  // --- API: status, settings, categories, latest results ---

  const checkStatus = async () => {
    try {
      const res = await fetch(`${API_BASE}/status`);
      if (res.ok) {
        const data = await res.json();
        setBackendStatus("running");
        setHasLlmKey(data.has_llm_key);
        setAiError(data.llm_error || null);
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
        // The saved plan is global; only use it if it was made for the folder now selected.
        const planFolder = localStorage.getItem("tidyflow_plan_folder");
        const currentFolder = localStorage.getItem("tidyflow_input_folder") || "";
        if (data.categories && Object.keys(data.categories).length > 0 && planFolder === currentFolder) {
          setCategories(toCategoryItems(data.categories));
        }
      }
    } catch (e) {
      console.error("Failed to load categories:", e);
    } finally {
      setCategoriesLoaded(true);
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

  /** The backend is the source of truth for the last run; drop any locally cached copy that disagrees. */
  const fetchLatestReport = async () => {
    try {
      const res = await fetch(`${API_BASE}/pipeline/latest`);
      if (!res.ok) return;
      const data = await res.json();
      const latest: ClassifiedFile[] = data.files || [];
      if (latest.length === 0) {
        clearResults();
        return;
      }
      const sameRun =
        files.length === latest.length && latest.every((f) => files.some((g) => g.file_id === f.file_id));
      setFiles(latest);
      setSummary(data.summary);
      setResultMeta({ inputDir: data.input_dir || "", categories: data.categories || [] });
      if (!sameRun) {
        // A different run than the one cached here: reset per-file choices.
        setCategoryOverrides({});
        setFilenameOverrides({});
        setSelectedFileIds(new Set(latest.filter((f) => f.action === "copy_to_organized").map((f) => f.file_id)));
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
    fetch(`${API_BASE}/fs/quick-locations`)
      .then((res) => res.json())
      .then((data) => {
        const locs: QuickLocation[] = data.locations || [];
        setQuickLocations(locs);
      })
      .catch((err) => console.error("Could not fetch quick locations:", err));

    const interval = setInterval(checkStatus, 6000);
    return () => clearInterval(interval);
  }, []);

  // Live progress from the backend while sorting
  useEffect(() => {
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API_BASE}/events`);
      es.addEventListener("pipeline_progress", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.stage) setCurrentStage(payload.stage);
          if (payload.message) setProgressLogs((prev) => [...prev, `> ${payload.message}`]);
        } catch {}
      });
      es.addEventListener("pipeline_error", (e) => {
        try {
          const payload = JSON.parse(e.data);
          if (payload.error) setProgressLogs((prev) => [...prev, `✗ Error: ${payload.error}`]);
        } catch {}
      });
      es.addEventListener("pipeline_cancelled", () => {
        setIsRunning(false);
        setIsCancelling(false);
        setCurrentStage("Cancelled");
      });
    } catch (e) {
      console.warn("EventSource setup error:", e);
    }
    return () => es?.close();
  }, []);

  // A sorting screen with nothing running (e.g. after an app restart) has nothing to show.
  useEffect(() => {
    if (step === "sorting" && !isRunning && !sortError && currentStage !== "Cancelled") {
      setStepState(hasResults && resultsAreForThisFolder ? "preview" : inputFolder ? "plan" : "home");
    }
    if (step === "done" && !doneResult) setStepState("home");
    if ((step === "plan" || step === "preview") && !inputFolder) setStepState("home");
  }, [step]);

  // --- Folder plan actions ---

  const persistCategories = (cats: Record<string, CategoryItem>) => {
    fetch(`${API_BASE}/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ categories: cats }),
    }).catch((e) => console.warn("Failed to save folders:", e));
  };

  const updateCategories = (cats: Record<string, CategoryItem>) => {
    setCategories(cats);
    persistCategories(cats);
    localStorage.setItem("tidyflow_plan_folder", inputFolder);
  };

  /** Setter for the advanced editors, which save to the backend themselves. */
  const setCategoriesFromEditor: React.Dispatch<React.SetStateAction<Record<string, CategoryItem>>> = (v) => {
    setCategories(v);
    localStorage.setItem("tidyflow_plan_folder", inputFolder);
  };

  const generationId = useRef(0);
  const handleGeneratePlan = async (level: ComplexityLevel = complexityLevel) => {
    if (!inputFolder) return;
    const id = ++generationId.current;
    setIsGenerating(true);
    setPlanError(null);
    setAssistantNote(null);
    setPlanChat([]);
    try {
      const res = await fetch(`${API_BASE}/ai/chat-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: `Analyze directory files and generate custom ${level} category taxonomy`,
          history: [],
          input_dir: inputFolder,
          complexity_level: level,
          auto_discover: true,
        }),
      });
      if (!res.ok) throw new Error("We couldn't read that folder.");
      const data = await res.json();
      if (id !== generationId.current) return;
      if (!data.categories || Object.keys(data.categories).length === 0) {
        throw new Error("We couldn't come up with folders for this one.");
      }
      updateCategories(toCategoryItems(data.categories));
      if (data.custom_instructions) setCustomInstructions(data.custom_instructions);
      setAiError(data.ai_error || null);
      setPlanIsBasic(!!data.ai_error || !hasLlmKey);
    } catch (e: any) {
      if (id === generationId.current) setPlanError(e?.message || "Something went wrong. Please try again.");
    } finally {
      if (id === generationId.current) setIsGenerating(false);
    }
  };

  const handleRefinePlan = async (message: string) => {
    const text = message.trim();
    if (!text || !inputFolder) return;
    setIsRefining(true);
    setPlanError(null);
    try {
      const res = await fetch(`${API_BASE}/ai/chat-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: planChat,
          input_dir: inputFolder,
          current_categories: categories,
          complexity_level: complexityLevel,
          auto_discover: false,
        }),
      });
      if (!res.ok) throw new Error("That change didn't work. Try saying it another way.");
      const data = await res.json();
      if (data.categories && Object.keys(data.categories).length > 0) {
        updateCategories(toCategoryItems(data.categories));
      }
      if (data.custom_instructions) setCustomInstructions(data.custom_instructions);
      setAiError(data.ai_error || null);
      setAssistantNote(data.message || null);
      setPlanChat((prev) => [
        ...prev,
        { role: "user", content: text },
        { role: "assistant", content: data.message || "" },
      ]);
    } catch (e: any) {
      setPlanError(e?.message || "Something went wrong. Please try again.");
    } finally {
      setIsRefining(false);
    }
  };

  const handleChangeDetail = (level: ComplexityLevel) => {
    if (level === complexityLevel) return;
    setComplexityLevel(level);
    handleGeneratePlan(level);
  };

  const handleRenameFolder = (oldName: string, newName: string) => {
    if (!newName || newName === oldName || categories[newName]) return;
    const next: Record<string, CategoryItem> = {};
    Object.entries(categories).forEach(([k, v]) => {
      if (k === oldName) next[newName] = { ...v, name: newName };
      else next[k] = v;
    });
    updateCategories(next);
  };

  const handleRemoveFolder = (name: string) => {
    const next = { ...categories };
    delete next[name];
    updateCategories(next);
  };

  const handleAddFolder = (name: string) => {
    if (!name || Object.keys(categories).some((k) => k.toLowerCase() === name.toLowerCase())) return;
    updateCategories({
      ...categories,
      [name]: { name, description: "", keywords: [], extensions: [], active: true },
    });
  };

  // Suggest folders automatically the first time a folder reaches the plan step.
  useEffect(() => {
    if (
      view === "flow" &&
      step === "plan" &&
      categoriesLoaded &&
      activeFolderNames.length === 0 &&
      !isGenerating &&
      !planError
    ) {
      handleGeneratePlan();
    }
  }, [view, step, categoriesLoaded, activeFolderNames.length]);

  // --- Category actions used by the advanced editors ---

  const handleToggleCategory = (catName: string) => {
    const existing = categories[catName];
    if (!existing) return;
    updateCategories({ ...categories, [catName]: { ...existing, active: !existing.active } });
  };

  const handleAddCategory = (newCat: { name: string; description: string; keywords: string[]; extensions: string[] }) => {
    updateCategories({ ...categories, [newCat.name]: { ...newCat, active: true } });
  };

  const handleLoadPreset = (presetCats: Record<string, CategoryItem>) => updateCategories(presetCats);

  // --- Sorting ---

  const clearResults = () => {
    setFiles([]);
    setSummary(null);
    setResultMeta(null);
    setSelectedFileIds(new Set());
    setCategoryOverrides({});
    setFilenameOverrides({});
  };

  const handleStartPipeline = async (
    customCats?: Record<string, CategoryItem>,
    instructions?: string,
    complexity?: ComplexityLevel
  ) => {
    if (!inputFolder.trim() || isRunning) return;
    setIsRunning(true);
    setSortError(null);
    setCurrentStage("scan");
    setProgressLogs([`> Looking in ${inputFolder}`]);
    setStep("sorting");

    const catsToUse = customCats || categories;
    const instructionsToUse = instructions !== undefined ? instructions : customInstructions;
    const levelToUse = complexity || complexityLevel || "medium";

    const activeCats: Record<string, any> = {};
    Object.entries(catsToUse).forEach(([name, item]) => {
      if (item.active) {
        activeCats[name] = { description: item.description, keywords: item.keywords, extensions: item.extensions };
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
      if (!res.ok) throw new Error(data.detail || data.error || "Sorting failed");
      if (data.status === "cancelled") return;

      const newFiles: ClassifiedFile[] = data.files || [];
      setFiles(newFiles);
      setSummary(data.summary || null);
      setResultMeta({ inputDir: data.input_dir || inputFolder.trim(), categories: data.categories || [] });
      setCategoryOverrides({});
      setFilenameOverrides({});
      if (data.output_dir) setOutputFolder(data.output_dir);
      // Files the AI is sure about start included; the rest wait for the user.
      setSelectedFileIds(new Set(newFiles.filter((f) => f.action === "copy_to_organized").map((f) => f.file_id)));

      setCurrentStage("finalize");
      setTimeout(() => {
        setIsRunning(false);
        setStep("preview");
      }, 600);
    } catch (err: any) {
      setSortError(err?.message || "Sorting failed");
      setCurrentStage("error");
      setIsRunning(false);
    }
  };

  const handleCancelPipeline = async () => {
    setIsCancelling(true);
    try {
      await fetch(`${API_BASE}/pipeline/cancel`, { method: "POST" });
    } catch (e) {
      console.warn("Cancel request failed:", e);
    } finally {
      setTimeout(() => {
        setIsRunning(false);
        setIsCancelling(false);
        setCurrentStage("Cancelled");
      }, 500);
    }
  };

  const handleReclassifyWithTier = async (tier: ComplexityLevel) => {
    if (!inputFolder.trim() || isRunning) return;
    setComplexityLevel(tier);
    await handleGeneratePlan(tier);
    setStep("plan");
  };

  // --- Organize (apply) ---

  const handleApplyDecisions = async () => {
    if (selectedFileIds.size === 0) return;
    setIsApplying(true);

    const decisionList: ApplyDecisionItem[] = files.map((f) => ({
      file_id: f.file_id,
      approved: selectedFileIds.has(f.file_id),
      override_category: categoryOverrides[f.file_id] || undefined,
      target_filename: filenameOverrides[f.file_id] || undefined,
    }));
    const perFolder = new Map<string, number>();
    files
      .filter((f) => selectedFileIds.has(f.file_id))
      .forEach((f) => {
        const folder = categoryOverrides[f.file_id] || f.category;
        perFolder.set(folder, (perFolder.get(folder) || 0) + 1);
      });
    const folders = [...perFolder.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
    const folderCount = folders.length;

    try {
      const res = await fetch(`${API_BASE}/pipeline/apply-direct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ output_dir: outputFolder, decisions: decisionList, dry_run: false, move_mode: moveMode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || data.error || "Failed to organize files");

      setUndoState("idle");
      setUndoMessage(null);
      setDoneResult({ count: data.applied_count, action: data.action, outputDir: data.output_dir, folderCount, folders });
      // These results have been used; Home shouldn't offer them again.
      clearResults();
      setStep("done");
    } catch (err: any) {
      alert(`Couldn't organize the files: ${err.message}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleUndo = async () => {
    setUndoState("working");
    try {
      const res = await fetch(`${API_BASE}/pipeline/undo-last`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Undo failed");
      setUndoState("done");
      setUndoMessage(
        data.skipped > 0
          ? `Undone. ${data.skipped} file${data.skipped === 1 ? " was" : "s were"} changed since, so we left ${data.skipped === 1 ? "it" : "them"}.`
          : "Undone. Everything is back the way it was."
      );
    } catch (e: any) {
      setUndoState("error");
      setUndoMessage(e?.message || "Undo failed");
    }
  };

  const handleTidyAnother = () => {
    clearResults();
    setDoneResult(null);
    setUndoState("idle");
    setUndoMessage(null);
    setStep("home");
  };

  // --- Preview actions ---

  const handleSetIncluded = (fileId: string, included: boolean) => {
    setSelectedFileIds((prev) => {
      const next = new Set(prev);
      if (included) next.add(fileId);
      else next.delete(fileId);
      return next;
    });
  };

  const handleMoveFile = (fileId: string, folder: string) => {
    setCategoryOverrides((prev) => ({ ...prev, [fileId]: folder }));
  };

  const handleToggleRenames = (enabled: boolean) => {
    if (!enabled) {
      setFilenameOverrides({});
      return;
    }
    const next: Record<string, string> = {};
    renameSuggestions.forEach((f) => {
      next[f.file_id] = f.suggested_filename as string;
    });
    setFilenameOverrides(next);
  };

  // --- Settings ---

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
        const saved = await res.json().catch(() => ({}));
        setAiError(saved.ai_error || null);
        setSaveSettingsSuccess(true);
        setApiKeyInput("");
        await fetchSettings();
        await checkStatus();
        setTimeout(() => setSaveSettingsSuccess(false), 3000);
      } else {
        const data = await res.json().catch(() => ({}));
        alert(`Failed to save settings: ${data.detail || data.message || res.statusText}`);
      }
    } catch (e: any) {
      alert(`Failed to save settings: ${e.message || "Network error"}`);
    }
  };

  // --- Search ---

  const handleFtsSearch = async (queryOverride?: string) => {
    const q = (queryOverride !== undefined ? queryOverride : ftsQuery).trim();
    if (!q) return;
    if (queryOverride !== undefined) setFtsQuery(queryOverride);
    setIsSearchingFts(true);
    setHasSearched(true);
    try {
      const res = await fetch(`${API_BASE}/search?q=${encodeURIComponent(q)}`);
      if (res.ok) {
        const data = await res.json();
        setFtsResults(data.results || []);
      }
    } catch (e) {
      console.error("Search error:", e);
    } finally {
      setIsSearchingFts(false);
    }
  };

  const handleClearFts = () => {
    setFtsQuery("");
    setFtsResults([]);
    setHasSearched(false);
  };

  // --- Folder picking ---

  /** Switch the folder being organized; a different folder starts a fresh plan. */
  const handleSelectFolder = (path: string) => {
    if (path === inputFolder) return;
    setInputFolder(path);
    setOutputFolder(`${path}/Organized`);
    setCategories({});
    localStorage.removeItem("tidyflow_plan_folder");
    setCustomInstructions("");
    setPlanError(null);
    setAssistantNote(null);
    setPlanChat([]);
    clearResults();
    setProgressLogs([]);
    setCurrentStage("");
  };

  const handlePickFolder = (path: string) => {
    handleSelectFolder(path);
    setStep("plan");
  };

  const handleBrowse = async (target: "source" | "destination") => {
    try {
      const res = await fetch(`${API_BASE}/fs/browse-native`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: target === "source" ? "Choose a folder to tidy" : "Choose where organized folders go",
          initial_dir: target === "source" ? inputFolder : outputFolder,
        }),
      });
      if (!res.ok) throw new Error("native picker unavailable");
      const data = await res.json();
      if (data.path && !data.cancelled) {
        if (target === "source") handlePickFolder(data.path);
        else setOutputFolder(data.path);
      } else if (data.error) {
        throw new Error(data.error);
      }
    } catch {
      setFolderPickerTarget(target);
      setFolderPickerOpen(true);
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

  const goToStep = (s: FlowStep) => {
    if (reachableSteps.includes(s)) setStep(s);
  };

  // --- Render ---

  const screenKey = view === "flow" ? `flow-${step}` : view;

  const renderFlowStep = () => {
    switch (step) {
      case "plan":
        return (
          <PlanScreen
            inputFolder={inputFolder}
            categories={categories}
            complexityLevel={complexityLevel}
            isGenerating={isGenerating}
            isRefining={isRefining}
            planError={planError}
            assistantNote={assistantNote}
            hasLlmKey={hasLlmKey}
            aiError={aiError}
            planIsBasic={planIsBasic}
            onOpenSettings={() => setView("settings")}
            onChangeDetail={handleChangeDetail}
            onRegenerate={() => handleGeneratePlan()}
            onRefine={handleRefinePlan}
            onRename={handleRenameFolder}
            onRemove={handleRemoveFolder}
            onAdd={handleAddFolder}
            onStart={() => handleStartPipeline()}
            onBack={() => setStep("home")}
            advancedMode={advancedMode}
            onOpenAdvancedEditor={() => setView("advanced_plan")}
          />
        );
      case "sorting":
        return (
          <SortingScreen
            inputFolder={inputFolder}
            stage={currentStage}
            logs={progressLogs}
            isCancelling={isCancelling}
            onCancel={handleCancelPipeline}
            error={sortError}
            onRetry={() => handleStartPipeline()}
            onBack={() => setStep("plan")}
          />
        );
      case "preview":
        return (
          <PreviewScreen
            files={files}
            folders={activeFolderNames}
            selectedFileIds={selectedFileIds}
            onSetIncluded={handleSetIncluded}
            categoryOverrides={categoryOverrides}
            onMoveFile={handleMoveFile}
            autoThreshold={autoThreshold}
            renameSuggestionCount={renameSuggestions.length}
            renamesEnabled={Object.keys(filenameOverrides).length > 0}
            onToggleRenames={handleToggleRenames}
            moveMode={moveMode}
            setMoveMode={setMoveMode}
            outputFolder={outputFolder}
            isStale={isStale}
            onResort={() => handleStartPipeline()}
            aiError={aiError}
            onOpenSettings={() => setView("settings")}
            isApplying={isApplying}
            onApply={handleApplyDecisions}
            onBack={() => setStep("plan")}
            onOpenFile={handleOpenPath}
            advancedMode={advancedMode}
            onOpenAdvancedReview={() => setView("advanced_review")}
          />
        );
      case "done":
        return doneResult ? (
          <DoneScreen
            result={doneResult}
            onOpenFolder={() => handleOpenPath(doneResult.outputDir)}
            onUndo={handleUndo}
            undoState={undoState}
            undoMessage={undoMessage}
            onTidyAnother={handleTidyAnother}
          />
        ) : null;
      default:
        return (
          <HomeScreen
            inputFolder={inputFolder}
            outputFolder={outputFolder}
            quickLocations={quickLocations}
            onPickFolder={handlePickFolder}
            onBrowse={() => handleBrowse("source")}
            onChangeOutput={() => handleBrowse("destination")}
            canResume={!!resultsAreForThisFolder && !isStale}
            resumeFileCount={files.length}
            onResume={() => setStep("preview")}
            hasLlmKey={hasLlmKey}
            aiError={aiError}
            onOpenSettings={() => setView("settings")}
            backendOnline={backendStatus !== "offline"}
          />
        );
    }
  };

  const renderView = () => {
    switch (view) {
      case "search":
        return (
          <SearchView
            ftsQuery={ftsQuery}
            setFtsQuery={setFtsQuery}
            ftsResults={ftsResults}
            isSearching={isSearchingFts}
            hasSearched={hasSearched}
            onSearch={handleFtsSearch}
            onClear={handleClearFts}
          />
        );
      case "settings":
        return (
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
            onAddCategory={async (c) => handleAddCategory(c)}
            onDeleteCategory={async (n) => handleRemoveFolder(n)}
            onLoadPreset={async (c) => handleLoadPreset(c)}
            advancedMode={advancedMode}
            setAdvancedMode={setAdvancedMode}
            hasLlmKey={hasLlmKey}
            aiError={aiError}
            darkMode={darkMode}
            toggleDarkMode={toggleDarkMode}
          />
        );
      case "advanced_plan":
        return (
          <Screen>
            <OrganizeView
              inputFolder={inputFolder}
              setInputFolder={handlePickFolder}
              outputFolder={outputFolder}
              setOutputFolder={setOutputFolder}
              useLlm={useLlm}
              setUseLlm={setUseLlm}
              isRunning={isRunning}
              currentStage={currentStage}
              progressLogs={progressLogs}
              categories={categories}
              setCategories={setCategoriesFromEditor}
              customInstructions={customInstructions}
              setCustomInstructions={setCustomInstructions}
              summary={summary}
              backendStatus={backendStatus}
              onStartPipeline={handleStartPipeline}
              onNavigateToReview={() => setStep("preview")}
              onNavigateToCategories={() => setView("settings")}
              onChangeFolder={() => setStep("home")}
              fileCount={files.length}
              complexityLevel={complexityLevel}
              setComplexityLevel={setComplexityLevel}
              onCancelPipeline={handleCancelPipeline}
              isCancelling={isCancelling}
            />
          </Screen>
        );
      case "advanced_review":
        return (
          <Screen>
            <ReviewView
              files={files}
              categories={categories}
              setCategories={setCategoriesFromEditor}
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
              applyResultModal={null}
              setApplyResultModal={() => {}}
              onApplyDecisions={handleApplyDecisions}
              onNavigateToOrganize={() => setStep("plan")}
              inputFolder={inputFolder}
              onNavigateToSelectFolder={() => setStep("home")}
              onNavigateToSearch={() => setView("search")}
              complexityLevel={complexityLevel}
              setComplexityLevel={setComplexityLevel}
              onReclassifyWithTier={handleReclassifyWithTier}
              isReclassifying={isRunning}
            />
          </Screen>
        );
      default:
        return renderFlowStep();
    }
  };

  return (
    <div className="tf-ambient min-h-screen text-tf-ink flex flex-col font-sans selection:bg-tf-brand/20 transition-colors duration-300">
      <TopBar
        view={view}
        step={step}
        reachableSteps={reachableSteps}
        onGoToStep={goToStep}
        onOpenView={(v) => setView(v)}
        darkMode={darkMode}
        toggleDarkMode={toggleDarkMode}
        backendStatus={backendStatus}
      />

      <DirectoryPickerModal
        isOpen={folderPickerOpen}
        onClose={() => setFolderPickerOpen(false)}
        onSelect={(path) => {
          setFolderPickerOpen(false);
          if (folderPickerTarget === "source") handlePickFolder(path);
          else setOutputFolder(path);
        }}
        initialPath={folderPickerTarget === "source" ? inputFolder : outputFolder}
        title={folderPickerTarget === "source" ? "Choose a folder to tidy" : "Choose where organized folders go"}
        description={
          folderPickerTarget === "source"
            ? "Pick the messy folder you'd like TidyFlow to sort."
            : "TidyFlow will create the new folders here."
        }
      />

      <main className="flex-1 w-full max-w-6xl mx-auto px-6 pt-8 pb-16">
        <AnimatePresence mode="wait">
          <div key={screenKey}>{renderView()}</div>
        </AnimatePresence>
      </main>
    </div>
  );
}

