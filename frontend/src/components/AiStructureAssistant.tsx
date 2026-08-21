import React, { useState, useRef, useEffect } from "react";
import { CategoryItem, ChatMessage } from "../types";
import { getStickerStyle } from "../utils/stickerTheme";
import {
  PRESET_PACKS,
  DEFAULT_STANDARD_CATEGORIES,
} from "../utils/presetCategories";
import {
  Sparkles,
  Send,
  Loader2,
  CheckCircle2,
  FolderTree,
  Trash2,
  Plus,
  FileCode,
  ArrowRight,
  Bot,
  User,
  Layers,
} from "lucide-react";

interface AiStructureAssistantProps {
  inputFolder: string;
  activeCategories: Record<string, CategoryItem>;
  setActiveCategories: (cats: Record<string, CategoryItem>) => void;
  customInstructions: string;
  setCustomInstructions: (instr: string) => void;
  onApproveAndOrganize: () => void;
  isRunning: boolean;
  backendStatus: string;
}

export const AiStructureAssistant: React.FC<AiStructureAssistantProps> = ({
  inputFolder,
  activeCategories,
  setActiveCategories,
  customInstructions,
  setCustomInstructions,
  onApproveAndOrganize,
  isRunning,
  backendStatus,
}) => {
  const [inputText, setInputText] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "welcome",
      role: "assistant",
      content:
        "Tell me how you'd like your workspace organized! You can pick one of the predefined category templates below or describe your custom structure in plain English. I'll propose a structure for you to verify before organizing.",
    },
  ]);
  const [hasProposedStructure, setHasProposedStructure] = useState(false);
  const [isEditingCategory, setIsEditingCategory] = useState(false);
  const [newCatName, setNewCatName] = useState("");

  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isGenerating]);

  // Load preset categories immediately (optimistic UI) and send prompt to AI
  const handleSelectPreset = async (_presetId: string, promptText: string, presetCats: Record<string, CategoryItem>) => {
    // 1. Immediately apply categories to the workspace state
    setActiveCategories(presetCats);
    setHasProposedStructure(true);

    // 2. Add assistant message & run chat
    await handleSendPrompt(promptText, presetCats);
  };

  const handleLoadStandardDefaults = () => {
    setActiveCategories(DEFAULT_STANDARD_CATEGORIES);
    setHasProposedStructure(true);
    const msgId = Date.now().toString();
    setMessages((prev) => [
      ...prev,
      {
        id: msgId,
        role: "assistant",
        content: `Loaded the full standard 18-folder predefined taxonomy covering Finance, Legal, Work, Personal, Development, Media, and Archives. You can tweak any folder or click "Approve & Start Organizing" below.`,
        categories: DEFAULT_STANDARD_CATEGORIES,
        isReady: true,
      },
    ]);
  };

  const handleSendPrompt = async (promptToSend?: string, overrideCats?: Record<string, CategoryItem>) => {
    const text = (promptToSend || inputText).trim();
    if (!text || isGenerating) return;

    const userMsgId = Date.now().toString();
    const newHistory = [
      ...messages,
      { id: userMsgId, role: "user" as const, content: text },
    ];
    setMessages(newHistory);
    setInputText("");
    setIsGenerating(true);

    try {
      const currentCats = overrideCats || activeCategories;
      const payload = {
        message: text,
        history: newHistory.map((m) => ({ role: m.role, content: m.content })),
        input_dir: inputFolder || undefined,
        current_categories: Object.keys(currentCats).length > 0 ? currentCats : undefined,
      };

      const res = await fetch("http://localhost:8000/ai/chat-structure", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        throw new Error("Failed to generate structure from AI");
      }

      const data = await res.json();
      const generatedCats: Record<string, CategoryItem> = {};

      if (data.categories && Object.keys(data.categories).length > 0) {
        Object.entries(data.categories).forEach(([name, c]: [string, any]) => {
          generatedCats[name] = {
            name: c.name || name,
            description: c.description || "",
            keywords: c.keywords || [],
            extensions: c.extensions || [],
            active: c.active !== false,
          };
        });
        setActiveCategories(generatedCats);
      }

      if (data.custom_instructions) {
        setCustomInstructions(data.custom_instructions);
      }
      setHasProposedStructure(true);

      const aiMsgId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        {
          id: aiMsgId,
          role: "assistant",
          content: data.message || "I've structured your workspace. Please verify below.",
          categories: Object.keys(generatedCats).length > 0 ? generatedCats : overrideCats,
          customInstructions: data.custom_instructions,
          isReady: data.is_ready,
        },
      ]);
    } catch (err: any) {
      // Fallback: If AI call failed but we already had preset categories, keep them!
      setHasProposedStructure(true);
      setMessages((prev) => [
        ...prev,
        {
          id: (Date.now() + 1).toString(),
          role: "assistant",
          content: `Applied template structure below (${Object.keys(overrideCats || activeCategories).length} folders). Note: AI connection notice: ${err.message}`,
        },
      ]);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleToggleCat = (catName: string) => {
    const existing = activeCategories[catName];
    if (!existing) return;
    setActiveCategories({
      ...activeCategories,
      [catName]: { ...existing, active: !existing.active },
    });
  };

  const handleDeleteCat = (catName: string) => {
    const updated = { ...activeCategories };
    delete updated[catName];
    setActiveCategories(updated);
  };

  const handleAddQuickCat = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newCatName.trim();
    if (!trimmed) return;
    setActiveCategories({
      ...activeCategories,
      [trimmed]: {
        name: trimmed,
        description: `Custom folder: ${trimmed}`,
        keywords: [trimmed.toLowerCase()],
        extensions: [],
        active: true,
      },
    });
    setNewCatName("");
    setIsEditingCategory(false);
  };

  const activeCount = Object.values(activeCategories).filter((c) => c.active).length;

  return (
    <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] overflow-hidden flex flex-col space-y-0">
      {/* Assistant Top Banner */}
      <div className="p-5 border-b border-[#e6e6e6] dark:border-[#2e2e2e] bg-linear-to-r from-[#f9fafb] to-[#ffffff] dark:from-[#242424] dark:to-[#202020] flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-linear-to-br from-[#0075de] to-[#9b51e0] text-white flex items-center justify-center shadow-xs">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-bold text-[#000000] dark:text-[#ffffff]">
                AI Organization Architect
              </h3>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#e8f4fd] dark:bg-[#0c3966]/40 text-[#0075de] dark:text-[#8bc5f8] font-semibold border border-[#0075de]/20">
                Interactive Control
              </span>
            </div>
            <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] mt-0.5">
              Command custom folder layouts, select predefined category packs, and refine anytime via chat.
            </p>
          </div>
        </div>

        {hasProposedStructure && (
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-[#166534] dark:text-[#4ade80] font-medium flex items-center gap-1.5 bg-[#dcfce7] dark:bg-[#052e16] px-2.5 py-1 rounded-full border border-[#86efac] dark:border-[#166534]">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{activeCount} Folders Configured</span>
            </span>
          </div>
        )}
      </div>

      {/* Preset Inspiration Pills Bar */}
      <div className="p-4 bg-[#fbfbfa] dark:bg-[#1c1c1c] border-b border-[#e6e6e6] dark:border-[#2e2e2e] space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[#a39e98]">
            Predefined Category Packs & Templates (Click to apply)
          </span>
          {!hasProposedStructure && (
            <button
              onClick={handleLoadStandardDefaults}
              className="text-[11px] font-semibold text-[#0075de] dark:text-[#2383e2] hover:underline cursor-pointer flex items-center gap-1"
            >
              <Layers className="w-3 h-3" />
              <span>Load Full Standard Taxonomy (18 Folders)</span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Default 18 Categories Action */}
          <button
            onClick={handleLoadStandardDefaults}
            disabled={isGenerating || isRunning}
            className="text-[12px] px-3 py-1.5 rounded-full border border-[#0075de]/30 dark:border-[#2383e2]/40 bg-[#e8f4fd] dark:bg-[#0c3966]/30 text-[#0075de] dark:text-[#8bc5f8] hover:bg-[#0075de] hover:text-white dark:hover:bg-[#2383e2] dark:hover:text-white transition-all cursor-pointer shadow-2xs flex items-center gap-1.5 active:scale-97 disabled:opacity-50 font-semibold"
          >
            <span>🌟</span>
            <span>All 18 Standard Categories</span>
          </button>

          {PRESET_PACKS.filter((p) => p.id !== "standard").map((preset) => (
            <button
              key={preset.id}
              onClick={() => handleSelectPreset(preset.id, preset.prompt, preset.categories)}
              disabled={isGenerating || isRunning}
              className="text-[12px] px-3 py-1.5 rounded-full border border-[#e6e6e6] dark:border-[#383838] bg-[#ffffff] dark:bg-[#252525] hover:border-[#0075de] dark:hover:border-[#2383e2] hover:bg-[#e8f4fd] dark:hover:bg-[#0c3966]/30 text-[#31302e] dark:text-[#d4d4d4] transition-all cursor-pointer shadow-2xs flex items-center gap-1.5 active:scale-97 disabled:opacity-50"
            >
              <span>{preset.emoji}</span>
              <span>{preset.name}</span>
              <span className="text-[10px] opacity-70 font-mono">
                ({Object.keys(preset.categories).length})
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Helpful Predefined Categories Callout if not yet expanded */}
      {!hasProposedStructure && Object.keys(activeCategories).length > 0 && (
        <div className="px-5 py-3 bg-[#e8f4fd]/50 dark:bg-[#0c3966]/20 border-b border-[#e6e6e6] dark:border-[#2e2e2e] flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[12px] text-[#31302e] dark:text-[#d4d4d4]">
            <Layers className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
            <span>
              <strong>{Object.keys(activeCategories).length} predefined categories</strong> are configured in your workspace.
            </span>
          </div>
          <button
            onClick={() => setHasProposedStructure(true)}
            className="text-[12px] font-semibold text-[#0075de] dark:text-[#8bc5f8] bg-[#ffffff] dark:bg-[#252525] hover:bg-[#0075de] hover:text-white px-3 py-1 rounded-md border border-[#0075de]/30 transition cursor-pointer shadow-2xs"
          >
            View & Customize Categories
          </button>
        </div>
      )}

      {/* Chat Thread Container */}
      <div className="p-5 max-h-[380px] overflow-y-auto space-y-4 bg-[#ffffff] dark:bg-[#1f1f1f]">
        {messages.map((msg) => {
          const isUser = msg.role === "user";
          return (
            <div
              key={msg.id}
              className={`flex gap-3 text-[13px] ${
                isUser ? "flex-row-reverse" : "flex-row"
              }`}
            >
              {/* Avatar */}
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-semibold shadow-2xs ${
                  isUser
                    ? "bg-[#0075de] text-white"
                    : "bg-[#f1f0ee] dark:bg-[#333333] text-[#31302e] dark:text-[#e0e0e0] border border-[#e6e6e6] dark:border-[#404040]"
                }`}
              >
                {isUser ? <User className="w-3.5 h-3.5" /> : <Bot className="w-3.5 h-3.5 text-[#0075de] dark:text-[#2383e2]" />}
              </div>

              {/* Message Bubble */}
              <div
                className={`max-w-[82%] rounded-2xl px-4 py-3 leading-relaxed shadow-2xs ${
                  isUser
                    ? "bg-[#0075de] text-white rounded-tr-xs"
                    : "bg-[#f6f5f4] dark:bg-[#282828] text-[#191919] dark:text-[#e8e8e8] border border-[#e6e6e6] dark:border-[#383838] rounded-tl-xs"
                }`}
              >
                <div className="whitespace-pre-wrap">{msg.content}</div>
              </div>
            </div>
          );
        })}

        {isGenerating && (
          <div className="flex gap-3 text-[13px] items-center">
            <div className="w-7 h-7 rounded-full bg-[#f1f0ee] dark:bg-[#333333] flex items-center justify-center text-xs">
              <Bot className="w-3.5 h-3.5 text-[#0075de] dark:text-[#2383e2]" />
            </div>
            <div className="bg-[#f6f5f4] dark:bg-[#282828] border border-[#e6e6e6] dark:border-[#383838] rounded-2xl px-4 py-2.5 flex items-center gap-2 text-[#615d59] dark:text-[#9b9a97]">
              <Loader2 className="w-4 h-4 animate-spin text-[#0075de] dark:text-[#2383e2]" />
              <span>Analyzing requirements & tailoring category structure...</span>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      {/* Verification & Proposed Categories Review Panel */}
      {hasProposedStructure && Object.keys(activeCategories).length > 0 && (
        <div className="p-5 border-t border-[#e6e6e6] dark:border-[#2e2e2e] bg-[#fafaf9] dark:bg-[#1b1b1b] space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FolderTree className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
              <h4 className="text-[14px] font-bold text-[#000000] dark:text-[#ffffff]">
                Verify Proposed Structure ({Object.keys(activeCategories).length} Categories)
              </h4>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsEditingCategory(true)}
                className="text-[12px] px-2.5 py-1 rounded-md bg-[#ffffff] dark:bg-[#282828] border border-[#e6e6e6] dark:border-[#383838] text-[#31302e] dark:text-[#d4d4d4] hover:border-[#0075de] flex items-center gap-1 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Folder</span>
              </button>
            </div>
          </div>

          {/* Inline Add Category */}
          {isEditingCategory && (
            <form onSubmit={handleAddQuickCat} className="flex gap-2 items-center">
              <input
                type="text"
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                placeholder="Category path, e.g. Work/Design_Mockups"
                className="flex-1 bg-[#ffffff] dark:bg-[#242424] border border-[#0075de] rounded-md px-3 py-1.5 text-[12px] text-[#000000] dark:text-[#ffffff] focus:outline-none"
                autoFocus
              />
              <button
                type="submit"
                className="px-3 py-1.5 bg-[#0075de] text-white text-[12px] font-semibold rounded-md cursor-pointer"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => setIsEditingCategory(false)}
                className="px-2.5 py-1.5 text-[12px] text-[#a39e98] hover:text-[#000000] dark:hover:text-[#ffffff] cursor-pointer"
              >
                Cancel
              </button>
            </form>
          )}

          {/* Interactive Category Cards Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
            {Object.entries(activeCategories).map(([name, cat]) => {
              const style = getStickerStyle(name);
              return (
                <div
                  key={name}
                  className={`p-3 rounded-lg border transition-all duration-150 flex flex-col justify-between gap-2 ${
                    cat.active
                      ? "bg-[#ffffff] dark:bg-[#232323] border-[#e6e6e6] dark:border-[#333333] shadow-2xs"
                      : "bg-[#f1f0ee]/50 dark:bg-[#191919]/50 border-[#e6e6e6]/60 dark:border-[#2e2e2e]/40 opacity-60"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <input
                        type="checkbox"
                        checked={cat.active}
                        onChange={() => handleToggleCat(name)}
                        className="w-3.5 h-3.5 rounded text-[#0075de] focus:ring-0 cursor-pointer"
                        title={cat.active ? "Enabled" : "Disabled"}
                      />
                      <span
                        className={`text-[12px] font-semibold px-2 py-0.5 rounded-sm border font-mono truncate ${style.bg} ${style.text} ${style.border}`}
                      >
                        {name}
                      </span>
                    </div>

                    <button
                      onClick={() => handleDeleteCat(name)}
                      className="text-[#a39e98] hover:text-[#9d174d] dark:hover:text-[#f472b6] p-1 rounded-sm cursor-pointer transition"
                      title="Remove category"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {cat.description && (
                    <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] line-clamp-1">
                      {cat.description}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-1 text-[10px] text-[#a39e98] font-mono">
                    {cat.extensions && cat.extensions.length > 0 && (
                      <span className="flex items-center gap-1 bg-[#f1f0ee] dark:bg-[#2d2d2d] px-1.5 py-0.5 rounded-sm text-[#31302e] dark:text-[#d4d4d4]">
                        <FileCode className="w-2.5 h-2.5" />
                        <span>{cat.extensions.slice(0, 3).join(", ")}</span>
                      </span>
                    )}
                    {cat.keywords && cat.keywords.length > 0 && (
                      <span className="bg-[#f1f0ee] dark:bg-[#2d2d2d] px-1.5 py-0.5 rounded-sm text-[#615d59] dark:text-[#9b9a97]">
                        {cat.keywords.slice(0, 2).join(", ")}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Custom Behavioral Rule Callout */}
          {customInstructions && (
            <div className="p-3 bg-[#e8f4fd]/50 dark:bg-[#0c3966]/20 border border-[#0075de]/20 rounded-lg flex items-start gap-2.5">
              <Sparkles className="w-4 h-4 text-[#0075de] dark:text-[#2383e2] shrink-0 mt-0.5" />
              <div>
                <span className="text-[11px] font-bold text-[#0075de] dark:text-[#8bc5f8] uppercase tracking-wider block">
                  Active Behavioral Rule
                </span>
                <p className="text-[12px] text-[#31302e] dark:text-[#d4d4d4] mt-0.5 leading-relaxed">
                  "{customInstructions}"
                </p>
              </div>
            </div>
          )}

          {/* Verification CTA Action */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <div className="text-[12px] text-[#615d59] dark:text-[#9b9a97]">
              Want changes? Type a follow-up message below, or click Approve to organize.
            </div>

            <button
              onClick={onApproveAndOrganize}
              disabled={isRunning || backendStatus !== "running" || activeCount === 0 || !inputFolder.trim()}
              className={`px-6 py-2.5 rounded-full font-semibold text-[14px] flex items-center gap-2 shadow-sm transition-all cursor-pointer ${
                isRunning || backendStatus !== "running" || activeCount === 0 || !inputFolder.trim()
                  ? "bg-[#e6e6e6] dark:bg-[#333333] text-[#a39e98] cursor-not-allowed"
                  : "bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] dark:hover:bg-[#1d70c2] text-white active:scale-97 shadow-[0_2px_4px_rgba(0,117,222,0.25)]"
              }`}
            >
              {isRunning ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>Processing Directory...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  <span>Approve & Start Organizing</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Bottom Chat Input Bar */}
      <div className="p-4 border-t border-[#e6e6e6] dark:border-[#2e2e2e] bg-[#ffffff] dark:bg-[#202020]">
        <div className="relative flex items-center">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSendPrompt();
              }
            }}
            placeholder={
              hasProposedStructure
                ? "Ask AI to tweak this structure (e.g. 'Also add a folder for Figma files' or 'Split photos by year')..."
                : "Describe your ideal categories or file rules in plain English..."
            }
            disabled={isGenerating || isRunning}
            className="w-full bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-full pl-4 pr-12 py-3 text-[13px] text-[#000000] dark:text-[#ffffff] placeholder-[#a39e98] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:ring-2 focus:ring-[#0075de]/15 shadow-2xs transition"
          />
          <button
            onClick={() => handleSendPrompt()}
            disabled={!inputText.trim() || isGenerating || isRunning}
            className="absolute right-2 w-8 h-8 rounded-full bg-[#0075de] hover:bg-[#005bab] dark:bg-[#2383e2] dark:hover:bg-[#1d70c2] text-white flex items-center justify-center disabled:opacity-40 transition-all cursor-pointer active:scale-95 shadow-2xs"
            title="Send prompt"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
};
