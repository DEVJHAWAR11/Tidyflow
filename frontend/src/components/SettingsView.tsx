import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ChevronRight, Sun, Moon, Check } from "lucide-react";
import type { CategoryItem } from "../types";
import { API_BASE } from "../config";
import { Screen, Card, Button, StepHeader, SectionTitle, ease } from "../flow/ui";
import { CategoriesView } from "./CategoriesView";
import { AiSetup, AiStatusPill, providerName, useAiSettings } from "./AiSetup";

/** Models worth suggesting for each service. The full list is loaded from the service itself. */
const SUGGESTED_MODELS: Record<string, { id: string; note: string }[]> = {
  deepseek: [
    { id: "deepseek-chat", note: "Fast and cheap. A good default." },
    { id: "deepseek-flash", note: "DeepSeek's current fast model." },
    { id: "deepseek-v4-pro", note: "Slower and dearer, better with hard-to-place documents." },
  ],
  groq: [
    { id: "llama-3.3-70b-versatile", note: "Accurate and very fast." },
    { id: "llama-3.1-8b-instant", note: "Fastest, for very large folders." },
  ],
  gemini: [
    { id: "gemini-2.5-flash", note: "Fast and cheap. A good default." },
    { id: "gemini-2.5-pro", note: "Slower and dearer, better with hard-to-place documents." },
  ],
  openai: [
    { id: "gpt-4o-mini", note: "Fast and cheap. A good default." },
    { id: "gpt-4o", note: "Slower and dearer, better with hard-to-place documents." },
  ],
  openrouter: [
    { id: "deepseek/deepseek-chat", note: "Fast and cheap. A good default." },
    { id: "deepseek/deepseek-v4-flash", note: "DeepSeek's current fast model." },
    { id: "google/gemini-2.5-flash", note: "Google's fast model." },
    { id: "openai/gpt-4o", note: "OpenAI's flagship." },
  ],
};

export interface SettingsViewProps {
  /** Runs after any setting is saved, so the rest of the app can pick it up */
  onSettingsChanged: () => void;
  /** Show the first-run welcome again */
  onShowWelcome: () => void;
  categories?: Record<string, CategoryItem>;
  onToggleCategory?: (catName: string) => void;
  onAddCategory?: (cat: {
    name: string;
    description: string;
    keywords: string[];
    extensions: string[];
  }) => Promise<void>;
  onDeleteCategory?: (catName: string) => Promise<void>;
  onLoadPreset?: (cats: Record<string, CategoryItem>) => Promise<void>;
  advancedMode?: boolean;
  setAdvancedMode?: (v: boolean) => void;
  darkMode?: boolean;
  toggleDarkMode?: () => void;
}

export function SettingsView({
  onSettingsChanged,
  onShowWelcome,
  categories = {},
  onToggleCategory,
  onAddCategory,
  onDeleteCategory,
  onLoadPreset,
  advancedMode,
  setAdvancedMode,
  darkMode,
  toggleDarkMode,
}: SettingsViewProps) {
  const ai = useAiSettings(onSettingsChanged);
  const settings = ai.settings;

  const [internalAdvancedMode, setInternalAdvancedMode] = useState(false);
  const isAdvanced = advancedMode !== undefined ? advancedMode : internalAdvancedMode;

  const [internalDarkMode, setInternalDarkMode] = useState(() => {
    if (typeof document !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return false;
  });
  const isDark = darkMode !== undefined ? darkMode : internalDarkMode;

  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
  const [liveModels, setLiveModels] = useState<string[]>([]);
  const [threshold, setThreshold] = useState<number | null>(null);
  const [saved, setSaved] = useState<"model" | "threshold" | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const savedTimer = useRef<number | undefined>(undefined);

  const provider = settings?.provider ?? "";
  const usable = !!settings?.ai_enabled && !!settings?.has_key;

  // "Working" should mean it works now: try the key in use once, each time this page is opened.
  const checkedOnOpen = useRef(false);
  useEffect(() => {
    if (checkedOnOpen.current || !usable || !provider) return;
    checkedOnOpen.current = true;
    ai.testKey(provider);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the settings first arrive
  }, [usable, provider]);

  // What the service really offers to this key, so the list never shows a model that doesn't exist.
  useEffect(() => {
    setLiveModels([]);
    if (!advancedOptionsOpen || !usable || !provider) return;
    let live = true;
    fetch(`${API_BASE}/settings/models?provider=${provider}`)
      .then((r) => (r.ok ? r.json() : { models: [] }))
      .then((d) => live && setLiveModels(d.models || []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [advancedOptionsOpen, usable, provider, settings?.masked_key]);

  const { suggested, others } = useMemo(() => {
    const all = SUGGESTED_MODELS[provider] ?? [];
    const known = liveModels.length ? all.filter((m) => liveModels.includes(m.id)) : all;
    const ids = new Set(known.map((m) => m.id));
    const current = settings?.model;
    const extra = liveModels.filter((id) => !ids.has(id));
    if (current && !ids.has(current) && !extra.includes(current)) extra.unshift(current);
    return { suggested: known, others: extra.slice(0, 200) };
  }, [provider, liveModels, settings?.model]);

  const flashSaved = (what: "model" | "threshold") => {
    setSaved(what);
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(null), 1800);
  };

  const saveModel = async (model: string) => {
    setSaveError(await ai.change({ model }));
    flashSaved("model");
  };

  const saveThreshold = async () => {
    if (threshold === null || threshold === settings?.auto_copy_threshold) return;
    const problem = await ai.change({ auto_copy_threshold: threshold });
    setSaveError(problem);
    if (!problem) flashSaved("threshold");
    setThreshold(null);
  };

  const handleToggleAdvanced = () => {
    if (setAdvancedMode) {
      setAdvancedMode(!isAdvanced);
    } else {
      setInternalAdvancedMode(!isAdvanced);
    }
  };

  const handleToggleDarkMode = () => {
    if (toggleDarkMode) {
      toggleDarkMode();
    } else {
      if (typeof document !== "undefined") {
        document.documentElement.classList.toggle("dark");
      }
      setInternalDarkMode(!isDark);
    }
  };

  const shownThreshold = threshold ?? settings?.auto_copy_threshold ?? 0.85;
  const modelNote = suggested.find((m) => m.id === settings?.model)?.note;
  const savedTick = (what: "model" | "threshold") =>
    saved === what && !saveError ? (
      <span className="inline-flex items-center gap-1 text-[12px] text-tf-success">
        <Check size={13} strokeWidth={2} /> Saved
      </span>
    ) : null;

  return (
    <Screen className="max-w-[720px] mx-auto pt-8 px-4 pb-16">
      <StepHeader title="Settings" subtitle="How TidyFlow reads your files, and how it looks." />

      <div className="mt-8 flex flex-col gap-8">
        {/* Section 1: Smart sorting */}
        <div>
          <SectionTitle aside={<AiStatusPill ai={ai} />}>Smart sorting</SectionTitle>
          <Card className="divide-y divide-tf-border overflow-hidden">
            <div className="p-4">
              <AiSetup ai={ai} />
            </div>

            {/* Advanced options: model and how sure TidyFlow must be */}
            <div className="divide-y divide-tf-border">
              <button
                type="button"
                aria-expanded={advancedOptionsOpen}
                onClick={() => setAdvancedOptionsOpen(!advancedOptionsOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-tf-surface-2/50 transition-colors cursor-pointer"
              >
                <span className="text-[13.5px] font-medium text-tf-ink">Advanced options</span>
                <ChevronRight
                  size={15}
                  strokeWidth={1.75}
                  className={`text-tf-muted transition-transform duration-150 ${advancedOptionsOpen ? "rotate-90" : ""}`}
                />
              </button>

              <AnimatePresence>
                {advancedOptionsOpen && settings && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, ease }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 space-y-5 bg-tf-surface-2/20">
                      {usable && (
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between">
                            <label htmlFor="tf-model" className="text-[13px] font-medium text-tf-ink">
                              {providerName(provider)} model
                            </label>
                            {savedTick("model")}
                          </div>
                          <select
                            id="tf-model"
                            value={settings.model}
                            onChange={(e) => saveModel(e.target.value)}
                            className="w-full h-9 rounded-[9px] border border-tf-border-strong bg-tf-surface px-3 text-[13.5px] text-tf-ink focus:outline-none focus:border-tf-ink focus:ring-1 focus:ring-tf-ink transition-colors cursor-pointer"
                          >
                            {suggested.length > 0 && (
                              <optgroup label="Suggested">
                                {suggested.map((m) => (
                                  <option key={m.id} value={m.id}>
                                    {m.id}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                            {others.length > 0 && (
                              <optgroup label={liveModels.length ? `Everything ${providerName(provider)} offers` : "Current"}>
                                {others.map((id) => (
                                  <option key={id} value={id}>
                                    {id}
                                  </option>
                                ))}
                              </optgroup>
                            )}
                          </select>
                          <p className="text-[12px] text-tf-muted leading-snug">
                            {modelNote ??
                              (liveModels.length > 0 && !liveModels.includes(settings.model)
                                ? `${providerName(provider)} doesn't list this model for your key, so it may stop working. Consider a suggested one.`
                                : "Not one of our suggestions. Sorting quality and cost depend on the model.")}
                          </p>
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[13px]">
                          <label htmlFor="tf-threshold" className="font-medium text-tf-ink">
                            How sure TidyFlow must be to sort a file on its own
                          </label>
                          <span className="flex items-center gap-2">
                            {savedTick("threshold")}
                            <span className="font-medium text-tf-ink tf-num">{Math.round(shownThreshold * 100)}%</span>
                          </span>
                        </div>
                        <input
                          id="tf-threshold"
                          type="range"
                          min="0.5"
                          max="1.0"
                          step="0.05"
                          value={shownThreshold}
                          onChange={(e) => setThreshold(parseFloat(e.target.value))}
                          onPointerUp={saveThreshold}
                          onKeyUp={saveThreshold}
                          onBlur={saveThreshold}
                          className="w-full accent-[var(--color-tf-brand)] cursor-pointer"
                        />
                        <div className="flex justify-between text-[12px] text-tf-muted">
                          <span>Sorts more on its own</span>
                          <span>Asks you more often</span>
                        </div>
                      </div>

                      {saveError && <p className="text-[12.5px] text-tf-danger">{saveError}</p>}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </Card>
        </div>

        {/* Section 2: Appearance */}
        <div>
          <SectionTitle>Appearance</SectionTitle>
          <Card className="p-4">
            <div className="inline-flex bg-tf-surface-2 p-0.5 rounded-[9px] border border-tf-border">
              <button
                type="button"
                onClick={() => {
                  if (isDark) handleToggleDarkMode();
                }}
                className={`inline-flex items-center gap-1.5 h-7 px-3 text-[13px] font-medium rounded-[7px] transition-all cursor-pointer ${
                  !isDark
                    ? "bg-tf-surface text-tf-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "text-tf-muted hover:text-tf-ink"
                }`}
              >
                <Sun size={14} strokeWidth={1.75} />
                <span>Light</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!isDark) handleToggleDarkMode();
                }}
                className={`inline-flex items-center gap-1.5 h-7 px-3 text-[13px] font-medium rounded-[7px] transition-all cursor-pointer ${
                  isDark
                    ? "bg-tf-surface text-tf-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                    : "text-tf-muted hover:text-tf-ink"
                }`}
              >
                <Moon size={14} strokeWidth={1.75} />
                <span>Dark</span>
              </button>
            </div>
          </Card>
        </div>

        {/* Section 3: Advanced */}
        <div>
          <SectionTitle>Advanced</SectionTitle>
          <Card className="divide-y divide-tf-border overflow-hidden">
            <div className="px-4 py-3.5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-tf-ink">
                  Show advanced tools
                </div>
                <div className="text-[12.5px] text-tf-muted mt-0.5">
                  Adds the detailed review table, rule editing and power-user controls.
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={isAdvanced}
                onClick={handleToggleAdvanced}
                className={`relative inline-flex items-center w-8 h-[18px] rounded-full transition-colors duration-150 cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-ink ${
                  isAdvanced ? "bg-tf-primary" : "bg-tf-surface-3"
                }`}
              >
                <motion.span
                  layout
                  transition={{ duration: 0.15, ease }}
                  className={`block w-3.5 h-3.5 rounded-full ${
                    isDark && isAdvanced ? "bg-tf-on-primary" : "bg-white"
                  } shadow-sm ml-0.5 ${
                    isAdvanced ? "translate-x-3.5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="px-4 py-3.5 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-tf-ink">Welcome tour</div>
                <div className="text-[12.5px] text-tf-muted mt-0.5">See the short introduction from the first launch again.</div>
              </div>
              <Button variant="secondary" size="sm" onClick={onShowWelcome} className="shrink-0">
                Show
              </Button>
            </div>

            {isAdvanced && onToggleCategory && onAddCategory && onDeleteCategory && (
              <div className="p-4">
                <CategoriesView
                  categories={categories}
                  onToggleCategory={onToggleCategory}
                  onAddCategory={onAddCategory}
                  onDeleteCategory={onDeleteCategory}
                  onLoadPreset={onLoadPreset}
                  hideBreadcrumb
                />
              </div>
            )}
          </Card>
        </div>
      </div>
    </Screen>
  );
}
