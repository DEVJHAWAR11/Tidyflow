import React from "react";
import { Key, Cpu, Check, Sliders } from "lucide-react";

interface SettingsViewProps {
  llmProvider: string;
  setLlmProvider: (val: string) => void;
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
  apiKeyInput,
  setApiKeyInput,
  maskedKey,
  autoThreshold,
  setAutoThreshold,
  saveSuccess,
  onSaveSettings,
}) => {
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
          Manage language model credentials, confidence thresholds, and system preferences.
        </p>
      </div>

      {/* Main Settings Form Card */}
      <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-6 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] space-y-6">
        {/* Provider Select */}
        <div>
          <label className="block text-[13px] font-semibold text-[#000000] dark:text-[#ffffff] mb-1 flex items-center gap-2">
            <Cpu className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
            <span>Language Model Provider</span>
          </label>
          <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] mb-2">
            Select the model provider used for reading and classifying file contents.
          </p>
          <select
            value={llmProvider}
            onChange={(e) => setLlmProvider(e.target.value)}
            className="w-full bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-3.5 py-2.5 text-[13px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:bg-[#ffffff] dark:focus:bg-[#191919] cursor-pointer"
          >
            <option value="deepseek">DeepSeek (deepseek-chat) — Fast & Cost-Effective</option>
            <option value="openai">OpenAI (gpt-4o / gpt-4o-mini)</option>
            <option value="groq">Groq (llama-3.3-70b-versatile)</option>
            <option value="openrouter">OpenRouter (Multi-model)</option>
            <option value="gemini">Google Gemini (gemini-2.0-flash)</option>
          </select>
        </div>

        <div className="border-t border-[#e6e6e6] dark:border-[#2e2e2e]" />

        {/* API Key Input */}
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

        {/* Auto Threshold Slider */}
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
