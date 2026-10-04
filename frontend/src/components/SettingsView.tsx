import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  KeyRound,
  ChevronRight,
  Sun,
  Moon,
  Check,
} from "lucide-react";
import type { CategoryItem } from "../types";
import { Screen, Card, Button, Pill, Dot, StepHeader, SectionTitle, ease } from "../flow/ui";
import { CategoriesView } from "./CategoriesView";

export interface ModelOption {
  id: string;
  name: string;
  badge?: string;
  description?: string;
}

export const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  deepseek: [
    {
      id: "deepseek-chat",
      name: "DeepSeek-V3 Chat (deepseek-chat)",
      badge: "Flagship V3",
      description: "DeepSeek-V3 671B MoE model — powerful, fast, and highly cost-effective",
    },
    {
      id: "deepseek-reasoner",
      name: "DeepSeek-R1 Reasoner (deepseek-reasoner)",
      badge: "Reasoning R1",
      description: "DeepSeek-R1 reasoning model with chain-of-thought verification",
    },
    {
      id: "deepseek-v4-flash",
      name: "DeepSeek-V4 Flash (deepseek-v4-flash)",
      badge: "Recommended",
      description: "Next-gen flagship V4 Flash — ultra-fast speed, high accuracy & low cost",
    },
    {
      id: "deepseek-v4-pro",
      name: "DeepSeek-V4 Pro (deepseek-v4-pro)",
      badge: "Frontier Reasoning",
      description: "Full-scale V4 frontier model for complex document reasoning and sorting",
    },
  ],
  groq: [
    {
      id: "llama-3.3-70b-versatile",
      name: "Llama 3.3 70B (llama-3.3-70b-versatile)",
      badge: "Recommended Flagship",
      description: "Meta Llama 3.3 70B running with extreme LPU throughput on Groq",
    },
    {
      id: "llama-3.1-8b-instant",
      name: "Llama 3.1 8B Instant (llama-3.1-8b-instant)",
      badge: "Ultra Fast",
      description: "Ultra-fast low-latency classification for high-volume file sorting",
    },
    {
      id: "openai/gpt-oss-120b",
      name: "GPT-OSS 120B (openai/gpt-oss-120b)",
      badge: "120B Flagship",
      description: "120B open-weights model running with extreme LPU throughput on Groq",
    },
    {
      id: "qwen-2.5-coder-32b",
      name: "Qwen 2.5 Coder 32B (qwen-2.5-coder-32b)",
      badge: "Code & Structure",
      description: "Specialized for source code, configuration files, and tabular data",
    },
    {
      id: "qwen-2.5-32b",
      name: "Qwen 2.5 32B (qwen-2.5-32b)",
      badge: "General 128k",
      description: "General-purpose 32B open model with 128k context window",
    },
  ],
  gemini: [
    {
      id: "gemini-3.7-flash",
      name: "Gemini 3.7 Flash (gemini-3.7-flash)",
      badge: "Recommended Next-Gen",
      description: "Google's newest flagship Flash tier optimized for agentic workflows & high speed",
    },
    {
      id: "gemini-3.6-flash",
      name: "Gemini 3.6 Flash (gemini-3.6-flash)",
      badge: "Agentic Fast",
      description: "High-speed agentic execution model for fast file categorization",
    },
    {
      id: "gemini-3.1-pro",
      name: "Gemini 3.1 Pro (gemini-3.1-pro)",
      badge: "Frontier Pro",
      description: "Flagship high-capability frontier model with deep multi-step reasoning",
    },
    {
      id: "gemini-3.5-flash-lite",
      name: "Gemini 3.5 Flash-Lite (gemini-3.5-flash-lite)",
      badge: "Ultra Budget",
      description: "Highest throughput and cost efficiency for scanning thousands of files",
    },
    {
      id: "gemini-2.5-flash",
      name: "Gemini 2.5 Flash (gemini-2.5-flash)",
      badge: "Proven Flash",
      description: "Stable, low-latency production flash model",
    },
    {
      id: "gemini-2.5-pro",
      name: "Gemini 2.5 Pro (gemini-2.5-pro)",
      badge: "Proven Pro",
      description: "Proven high-capability model with massive context window",
    },
  ],
  openai: [
    {
      id: "gpt-4o-mini",
      name: "GPT-4o Mini (gpt-4o-mini)",
      badge: "Recommended Budget",
      description: "Fast, accurate, cost-effective multimodal model for high-volume sorting",
    },
    {
      id: "gpt-4o",
      name: "GPT-4o (gpt-4o)",
      badge: "Flagship",
      description: "Omni model with industry-leading multimodal comprehension & JSON fidelity",
    },
    {
      id: "o3-mini",
      name: "o3-mini (o3-mini)",
      badge: "Fast Reasoning",
      description: "State-of-the-art fast reasoning model with configurable reasoning effort",
    },
    {
      id: "o1",
      name: "o1 (o1)",
      badge: "Deep Reasoning",
      description: "Frontier multi-step reasoning for ambiguous document categorization",
    },
    {
      id: "o1-mini",
      name: "o1-mini (o1-mini)",
      badge: "Logic / Code",
      description: "Lightweight reasoning model optimized for code and technical documentation",
    },
    {
      id: "chatgpt-4o-latest",
      name: "ChatGPT-4o Latest (chatgpt-4o-latest)",
      badge: "Continuous",
      description: "Continuously updated dynamic GPT-4o snapshot",
    },
  ],
  openrouter: [
    {
      id: "anthropic/claude-3.7-sonnet",
      name: "Claude 3.7 Sonnet (anthropic/claude-3.7-sonnet)",
      badge: "Top Ranked",
      description: "Hybrid reasoning & precision coding — #1 ranked model on OpenRouter",
    },
    {
      id: "deepseek/deepseek-v4-pro",
      name: "DeepSeek V4 Pro (deepseek/deepseek-v4-pro)",
      badge: "DeepSeek V4",
      description: "Full DeepSeek-V4 frontier model via OpenRouter",
    },
    {
      id: "deepseek/deepseek-v4-flash",
      name: "DeepSeek V4 Flash (deepseek/deepseek-v4-flash)",
      badge: "DeepSeek Flash",
      description: "Ultra-fast DeepSeek-V4 instance for high-throughput classification",
    },
    {
      id: "openai/gpt-4o",
      name: "OpenAI GPT-4o (openai/gpt-4o)",
      badge: "OpenAI Flagship",
      description: "OpenAI GPT-4o flagship accessible through OpenRouter gateway",
    },
    {
      id: "openai/o3-mini",
      name: "OpenAI o3-mini (openai/o3-mini)",
      badge: "OpenAI Reasoning",
      description: "OpenAI o3-mini fast STEM and structured reasoning",
    },
    {
      id: "google/gemini-3.7-flash",
      name: "Gemini 3.7 Flash (google/gemini-3.7-flash)",
      badge: "Google Next-Gen",
      description: "Google Gemini 3.7 Flash via unified OpenRouter endpoint",
    },
    {
      id: "anthropic/claude-3.5-sonnet",
      name: "Claude 3.5 Sonnet (anthropic/claude-3.5-sonnet)",
      badge: "Proven Accuracy",
      description: "Proven industry-standard document analysis and taxonomy generation",
    },
  ],
};

const PROVIDERS = [
  { id: "deepseek", name: "DeepSeek", description: "Great value, very capable" },
  { id: "groq", name: "Groq", description: "Very fast" },
  { id: "gemini", name: "Google Gemini", description: "Google's AI" },
  { id: "openai", name: "OpenAI", description: "ChatGPT's maker" },
  { id: "openrouter", name: "OpenRouter", description: "Many models, one key" },
];

export interface SettingsViewProps {
  llmProvider: string;
  setLlmProvider: (val: string) => void;
  selectedModel: string;
  setSelectedModel: (val: string) => void;
  apiKeyInput: string;
  setApiKeyInput: (val: string) => void;
  maskedKey: string;
  autoThreshold: number;
  setAutoThreshold: (val: number) => void;
  saveSuccess: boolean;
  onSaveSettings: () => Promise<void>;
  subTab?: "general" | "categories";
  setSubTab?: (tab: "general" | "categories") => void;
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
  hasLlmKey?: boolean;
  aiError?: string | null;
  darkMode?: boolean;
  toggleDarkMode?: () => void;
}

export function SettingsView({
  llmProvider,
  setLlmProvider,
  selectedModel,
  setSelectedModel,
  apiKeyInput,
  setApiKeyInput,
  maskedKey,
  autoThreshold,
  setAutoThreshold,
  saveSuccess,
  onSaveSettings,
  categories = {},
  onToggleCategory,
  onAddCategory,
  onDeleteCategory,
  onLoadPreset,
  advancedMode,
  setAdvancedMode,
  hasLlmKey,
  aiError,
  darkMode,
  toggleDarkMode,
}: SettingsViewProps) {
  const [internalAdvancedMode, setInternalAdvancedMode] = useState(false);
  const isAdvanced = advancedMode !== undefined ? advancedMode : internalAdvancedMode;

  const [internalDarkMode, setInternalDarkMode] = useState(() => {
    if (typeof document !== "undefined") {
      return document.documentElement.classList.contains("dark");
    }
    return false;
  });
  const isDark = darkMode !== undefined ? darkMode : internalDarkMode;

  const [showKeyHelp, setShowKeyHelp] = useState(false);
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);

  const isLlmActive = hasLlmKey !== undefined ? hasLlmKey : Boolean(maskedKey || apiKeyInput.trim());

  const currentModelList = PROVIDER_MODELS[llmProvider] || PROVIDER_MODELS.deepseek;

  useEffect(() => {
    const isValid = currentModelList.some((m) => m.id === selectedModel);
    if (!isValid && currentModelList.length > 0) {
      setSelectedModel(currentModelList[0].id);
    }
  }, [llmProvider, currentModelList, selectedModel, setSelectedModel]);

  const handleProviderChange = (newProvider: string) => {
    setLlmProvider(newProvider);
    const models = PROVIDER_MODELS[newProvider] || PROVIDER_MODELS.deepseek;
    if (models.length > 0) {
      setSelectedModel(models[0].id);
    }
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

  const selectedModelObj = currentModelList.find((m) => m.id === selectedModel);
  const currentProvider = PROVIDERS.find((p) => p.id === llmProvider);
  const providerLabel = currentProvider ? currentProvider.name : llmProvider;

  return (
    <Screen className="max-w-[720px] mx-auto pt-8 px-4 pb-16">
      <StepHeader
        title="Settings"
        subtitle="Preferences for sorting and appearance."
      />

      <div className="mt-8 flex flex-col gap-8">
        {/* Section 1: Smart sorting */}
        <div>
          <SectionTitle>Smart sorting</SectionTitle>
          <Card className="divide-y divide-tf-border overflow-hidden">
            {/* Status row */}
            <div className="px-4 py-3.5 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[13.5px] font-medium text-tf-ink">Status</span>
                {aiError ? (
                  <Pill tone="danger">
                    <Dot />
                    <span>Not working</span>
                  </Pill>
                ) : isLlmActive ? (
                  <Pill tone="success">
                    <Dot />
                    <span>Connected · {providerLabel}</span>
                  </Pill>
                ) : (
                  <Pill tone="neutral">
                    <Dot />
                    <span>Off</span>
                  </Pill>
                )}
              </div>
              {aiError && (
                <div className="text-[12.5px] text-tf-danger">
                  {aiError.replace(/\s+in Settings\.?$/i, ".")}
                </div>
              )}
            </div>

            {/* Provider row */}
            <div className="p-4 space-y-2">
              <div>
                <div className="text-[13px] font-medium text-tf-ink">Provider</div>
                <div className="text-[12.5px] text-tf-muted">
                  TidyFlow sends file names and short text excerpts to this service.
                </div>
              </div>

              <div className="rounded-[10px] border border-tf-border divide-y divide-tf-border overflow-hidden">
                {PROVIDERS.map((p) => {
                  const isSelected = llmProvider === p.id;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleProviderChange(p.id)}
                      className={`w-full h-12 px-3.5 flex items-center gap-3 text-left transition-colors cursor-pointer hover:bg-tf-surface-2 ${
                        isSelected ? "bg-tf-surface-2/60" : "bg-tf-surface"
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full shrink-0 transition-all ${
                          isSelected
                            ? "border-[5px] border-tf-primary bg-tf-surface"
                            : "border border-tf-border-strong bg-tf-surface"
                        }`}
                      />
                      <span className="text-[13.5px] font-medium text-tf-ink">{p.name}</span>
                      <span className="text-[12.5px] text-tf-muted ml-auto truncate hidden sm:inline">
                        {p.description}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* API key row */}
            <div className="p-4 space-y-2">
              <label className="block text-[13px] font-medium text-tf-ink">API key</label>
              <div className="relative">
                <KeyRound
                  size={15}
                  strokeWidth={1.75}
                  className="absolute left-3.5 top-1/2 -translate-y-1/2 text-tf-faint pointer-events-none"
                />
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="Paste a new key"
                  className="w-full h-10 rounded-[8px] pl-9 pr-3 text-[13.5px] bg-tf-surface border border-tf-border-strong text-tf-ink placeholder:text-tf-faint focus:outline-none focus:border-tf-ink focus:ring-1 focus:ring-tf-ink transition-colors font-mono"
                />
              </div>

              {maskedKey && (
                <div className="text-[12.5px] text-tf-muted">
                  Saved key <span className="font-mono text-tf-ink-2">{maskedKey}</span> · saved only on this computer
                </div>
              )}

              <div>
                <button
                  type="button"
                  onClick={() => setShowKeyHelp(!showKeyHelp)}
                  className="text-[12.5px] text-tf-link hover:underline cursor-pointer"
                >
                  How do I get a key?
                </button>
                <AnimatePresence>
                  {showKeyHelp && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18, ease }}
                      className="overflow-hidden mt-1.5"
                    >
                      <div className="text-[12.5px] text-tf-muted bg-tf-surface-2 p-3 rounded-[8px] border border-tf-border">
                        Create an account on {providerLabel}'s website, open its API keys page, generate a key and paste it here.
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Advanced options disclosure row */}
            <div className="divide-y divide-tf-border">
              <button
                type="button"
                onClick={() => setAdvancedOptionsOpen(!advancedOptionsOpen)}
                className="w-full px-4 py-3 flex items-center justify-between text-left hover:bg-tf-surface-2/50 transition-colors cursor-pointer"
              >
                <span className="text-[13.5px] font-medium text-tf-ink">Advanced options</span>
                <ChevronRight
                  size={15}
                  strokeWidth={1.75}
                  className={`text-tf-muted transition-transform duration-150 ${
                    advancedOptionsOpen ? "rotate-90" : ""
                  }`}
                />
              </button>

              <AnimatePresence>
                {advancedOptionsOpen && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.18, ease }}
                    className="overflow-hidden"
                  >
                    <div className="p-4 space-y-4 bg-tf-surface-2/20">
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[13px] font-medium text-tf-ink">Model</label>
                          {selectedModelObj?.badge && (
                            <Pill tone="brand">{selectedModelObj.badge}</Pill>
                          )}
                        </div>
                        <select
                          value={selectedModel}
                          onChange={(e) => setSelectedModel(e.target.value)}
                          className="w-full h-9 rounded-[9px] border border-tf-border-strong bg-tf-surface px-3 text-[13.5px] text-tf-ink focus:outline-none focus:border-tf-ink focus:ring-1 focus:ring-tf-ink transition-colors cursor-pointer"
                        >
                          {currentModelList.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} {m.badge ? `(${m.badge})` : ""}
                            </option>
                          ))}
                        </select>
                        {selectedModelObj?.description && (
                          <p className="text-[12px] text-tf-muted leading-snug">
                            {selectedModelObj.description}
                          </p>
                        )}
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-[13px]">
                          <span className="font-medium text-tf-ink">Confidence threshold</span>
                          <span className="font-medium text-tf-ink tf-num">
                            {Math.round(autoThreshold * 100)}%
                          </span>
                        </div>
                        <input
                          type="range"
                          min="0.5"
                          max="1.0"
                          step="0.05"
                          value={autoThreshold}
                          onChange={(e) => setAutoThreshold(parseFloat(e.target.value))}
                          className="w-full accent-[var(--color-tf-brand)] cursor-pointer"
                        />
                        <div className="flex justify-between text-[12px] text-tf-muted">
                          <span>Sort more on its own</span>
                          <span>Ask me more often</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Footer row */}
            <div className="px-4 py-3 flex justify-end gap-3 items-center bg-tf-surface-2/40">
              {saveSuccess && (
                <span className="inline-flex items-center gap-1.5 text-[12.5px] text-tf-success">
                  <Check size={14} strokeWidth={2} />
                  <span>Saved</span>
                </span>
              )}
              <Button
                variant="primary"
                size="md"
                onClick={onSaveSettings}
              >
                Save
              </Button>
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
