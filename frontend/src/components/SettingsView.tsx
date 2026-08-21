import React, { useEffect } from "react";
import { Key, Cpu, Check, Sliders, Sparkles } from "lucide-react";

export interface ModelOption {
  id: string;
  name: string;
  badge?: string;
  description?: string;
}

export const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  deepseek: [
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
    {
      id: "deepseek-v4-flash-vision-exp",
      name: "DeepSeek-V4 Flash Vision (deepseek-v4-flash-vision-exp)",
      badge: "Multimodal Vision",
      description: "Experimental multimodal vision model for direct image & scanned document analysis",
    },
  ],
  groq: [
    {
      id: "openai/gpt-oss-120b",
      name: "GPT-OSS 120B (openai/gpt-oss-120b)",
      badge: "Recommended Flagship",
      description: "120B open-weights model running with extreme LPU throughput on Groq",
    },
    {
      id: "openai/gpt-oss-20b",
      name: "GPT-OSS 20B (openai/gpt-oss-20b)",
      badge: "Ultra Fast",
      description: "20B high-efficiency reasoning model for rapid file classification",
    },
    {
      id: "qwen/qwen3.6-27b",
      name: "Qwen 3.6 27B (qwen/qwen3.6-27b)",
      badge: "Multimodal",
      description: "27B vision + text model with thinking modes on Groq LPU",
    },
    {
      id: "qwen-2.5-coder-32b",
      name: "Qwen 2.5 Coder 32B (qwen-2.5-coder-32b)",
      badge: "Code & Structure",
      description: "Specialized for source code, configuration files, and tabular data",
    },
    {
      id: "qwen-qwq-32b",
      name: "Qwen QwQ 32B (qwen-qwq-32b)",
      badge: "Math & Logic",
      description: "High-precision logic & math reasoning model",
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

interface SettingsViewProps {
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
}

export const SettingsView: React.FC<SettingsViewProps> = ({
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
}) => {
  const currentModelList = PROVIDER_MODELS[llmProvider] || PROVIDER_MODELS.deepseek;

  // Auto-sync model if selected model is not valid for the active provider
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

  const selectedModelObj = currentModelList.find((m) => m.id === selectedModel);

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl mx-auto">
      {/* Header */}
      <div className="border-b border-[#e6e6e6] dark:border-[#2e2e2e] pb-4">
        <div className="flex items-center gap-2 text-[13px] text-[#615d59] dark:text-[#9b9a97] mb-1 font-medium">
          <span>Workspace</span>
          <span>/</span>
          <span className="text-[#000000] dark:text-[#ffffff]">Preferences</span>
        </div>
        <h2 className="text-3xl font-bold text-[#000000] dark:text-[#ffffff] tracking-heading-1">
          Settings
        </h2>
        <p className="text-[15px] text-[#615d59] dark:text-[#9b9a97] mt-1">
          Manage language model credentials, active models, confidence thresholds, and system preferences.
        </p>
      </div>

      {/* Main Settings Form Card */}
      <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] space-y-6">
        
        {/* 1. Language Model Provider Select */}
        <div>
          <label className="block text-[13px] font-semibold text-[#000000] dark:text-[#ffffff] mb-1 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
            <span>Language Model Provider</span>
          </label>
          <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] mb-2">
            Select the model provider platform used for reading and classifying file contents.
          </p>
          <select
            value={llmProvider}
            onChange={(e) => handleProviderChange(e.target.value)}
            className="w-full bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3.5 py-2.5 text-[13px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:bg-[#ffffff] dark:focus:bg-[#191919] cursor-pointer font-medium"
          >
            <option value="deepseek">DeepSeek</option>
            <option value="groq">Groq</option>
            <option value="gemini">Google Gemini</option>
            <option value="openai">OpenAI</option>
            <option value="openrouter">OpenRouter</option>
          </select>
        </div>

        {/* 2. Dynamic Model Selection Dropdown (Latest Active Models) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[13px] font-semibold text-[#000000] dark:text-[#ffffff] flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#f59e0b] dark:text-[#fbbf24]" />
              <span>Model Selection</span>
            </label>
            {selectedModelObj?.badge && (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-full bg-[#eff6ff] dark:bg-[#1e3a8a]/40 text-[#1d4ed8] dark:text-[#93c5fd] border border-[#bfdbfe] dark:border-[#1e40af]">
                {selectedModelObj.badge}
              </span>
            )}
          </div>
          <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] mb-2">
            Choose from the latest active, in-service models for {llmProvider.toUpperCase()}.
          </p>
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="w-full bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3.5 py-2.5 text-[13px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:bg-[#ffffff] dark:focus:bg-[#191919] cursor-pointer font-medium"
          >
            {currentModelList.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} {m.badge ? `— [${m.badge}]` : ""}
              </option>
            ))}
          </select>
          {selectedModelObj?.description && (
            <p className="text-[11px] text-[#86837e] dark:text-[#a1a1aa] mt-1.5 font-sans">
              ℹ️ {selectedModelObj.description}
            </p>
          )}
        </div>

        <div className="border-t border-[#e6e6e6] dark:border-[#2e2e2e]" />

        {/* 3. API Key Input */}
        <div>
          <label className="block text-[13px] font-semibold text-[#000000] dark:text-[#ffffff] mb-1 flex items-center gap-2">
            <Key className="w-4 h-4 text-[#9b51e0] dark:text-[#d8b4fe]" />
            <span>Provider API Key</span>
            {maskedKey && (
              <span className="text-[11px] text-[#166534] dark:text-[#4ade80] bg-[#ecf7ed] dark:bg-[#0c3917]/40 border border-[#1aae39]/30 px-2 py-0.2 rounded-full font-mono">
                Active: {maskedKey}
              </span>
            )}
          </label>
          <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] mb-2">
            Your key is encrypted locally and stored in your operating system's secure keyring.
          </p>
          <input
            type="password"
            value={apiKeyInput}
            onChange={(e) => setApiKeyInput(e.target.value)}
            placeholder={maskedKey ? "Enter new key to update..." : "sk-..."}
            className="w-full bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3.5 py-2.5 text-[13px] font-mono text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:bg-[#ffffff] dark:focus:bg-[#191919]"
          />
        </div>

        <div className="border-t border-[#e6e6e6] dark:border-[#2e2e2e]" />

        {/* 4. Auto Threshold Slider */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-[13px] font-semibold text-[#000000] dark:text-[#ffffff] flex items-center gap-2">
              <Sliders className="w-4 h-4 text-[#dd5b00] dark:text-[#fb923c]" />
              <span>Auto-Approval Confidence Threshold</span>
            </label>
            <span className="text-[13px] font-mono font-bold text-[#0075de] dark:text-[#2383e2]">
              {Math.round(autoThreshold * 100)}%
            </span>
          </div>
          <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] mb-3">
            Files with classification confidence at or above this score are automatically selected for organization.
          </p>
          <input
            type="range"
            min="0.5"
            max="1.0"
            step="0.05"
            value={autoThreshold}
            onChange={(e) => setAutoThreshold(parseFloat(e.target.value))}
            className="w-full accent-[#0075de] dark:accent-[#2383e2] cursor-pointer"
          />
          <div className="flex justify-between text-[11px] text-[#a39e98] font-mono mt-1">
            <span>50% (Permissive)</span>
            <span>85% (Standard)</span>
            <span>100% (Strict)</span>
          </div>
        </div>

        {saveSuccess && (
          <div className="bg-[#ecf7ed] dark:bg-[#0c3917]/40 border border-[#1aae39]/30 text-[#166534] dark:text-[#4ade80] text-[13px] p-3 rounded-lg flex items-center gap-2 font-medium">
            <Check className="w-4 h-4" />
            <span>Settings saved successfully!</span>
          </div>
        )}

        <button
          onClick={onSaveSettings}
          className="w-full py-2.5 bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] dark:hover:bg-[#1d70c2] text-white font-semibold text-[14px] rounded-full shadow-xs transition active:scale-97 cursor-pointer"
        >
          Save Configuration
        </button>
      </div>
    </div>
  );
};
