import React, { useState } from "react";
import { CategoryItem } from "../types";
import { getStickerStyle } from "../utils/stickerTheme";
import {
  PRESET_PACKS,
  DEFAULT_STANDARD_CATEGORIES,
} from "../utils/presetCategories";
import {
  Plus,
  Trash2,
  X,
  FileSearch,
  Search,
  FileCode,
  Sparkles,
  RotateCcw,
  Layers,
  Check,
} from "lucide-react";

interface CategoriesViewProps {
  categories: Record<string, CategoryItem>;
  onToggleCategory: (catName: string) => void;
  onAddCategory: (cat: {
    name: string;
    description: string;
    keywords: string[];
    extensions: string[];
  }) => Promise<void>;
  onDeleteCategory: (catName: string) => Promise<void>;
  onLoadPreset?: (cats: Record<string, CategoryItem>) => Promise<void>;
}

export const CategoriesView: React.FC<CategoriesViewProps> = ({
  categories,
  onToggleCategory,
  onAddCategory,
  onDeleteCategory,
  onLoadPreset,
}) => {
  const [isAdding, setIsAdding] = useState(false);
  const [catName, setCatName] = useState("");
  const [catDesc, setCatDesc] = useState("");
  const [catKeywords, setCatKeywords] = useState("");
  const [catExtensions, setCatExtensions] = useState("");
  const [searchFilter, setSearchFilter] = useState("");
  const [justLoadedPreset, setJustLoadedPreset] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = catName.trim();
    if (!trimmed) return;

    const kwList = catKeywords
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean);
    const extList = catExtensions
      .split(",")
      .map((e) => (e.trim().startsWith(".") ? e.trim() : "." + e.trim()))
      .filter(Boolean);

    await onAddCategory({
      name: trimmed,
      description: catDesc.trim() || trimmed,
      keywords: kwList,
      extensions: extList,
    });

    setIsAdding(false);
    setCatName("");
    setCatDesc("");
    setCatKeywords("");
    setCatExtensions("");
  };

  const handleApplyPreset = async (presetId: string, presetCats: Record<string, CategoryItem>) => {
    if (onLoadPreset) {
      await onLoadPreset(presetCats);
      setJustLoadedPreset(presetId);
      setTimeout(() => setJustLoadedPreset(null), 2500);
    }
  };

  const filteredList = Object.entries(categories).filter(([name, item]) => {
    if (!searchFilter.trim()) return true;
    const q = searchFilter.toLowerCase();
    return (
      name.toLowerCase().includes(q) ||
      (item.description && item.description.toLowerCase().includes(q)) ||
      (item.keywords && item.keywords.some((k) => k.toLowerCase().includes(q)))
    );
  });

  const totalCount = Object.keys(categories).length;
  const activeCount = Object.values(categories).filter((c) => c.active).length;

  return (
    <div className="space-y-6 animate-fade-in max-w-6xl mx-auto">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#e6e6e6] dark:border-[#2e2e2e] pb-4">
        <div>
          <div className="flex items-center gap-2 text-[13px] text-[#615d59] dark:text-[#9b9a97] mb-1 font-medium">
            <span>Workspace</span>
            <span>/</span>
            <span className="text-[#000000] dark:text-[#ffffff]">Categories</span>
          </div>
          <div className="flex items-center gap-3">
            <h2 className="text-3xl font-bold text-[#000000] dark:text-[#ffffff] tracking-heading-1">
              Categories & Rules
            </h2>
            <span className="text-[12px] font-mono px-2.5 py-0.5 rounded-full bg-[#f1f0ee] dark:bg-[#2c2c2c] text-[#615d59] dark:text-[#9b9a97] font-semibold">
              {activeCount} Active / {totalCount} Total
            </span>
          </div>
          <p className="text-[15px] text-[#615d59] dark:text-[#9b9a97] mt-1">
            Configure destination folders, keyword rules, and description criteria.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Quick Search */}
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#a39e98] absolute left-3 top-3" />
            <input
              type="text"
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              placeholder="Search categories..."
              className="bg-[#ffffff] dark:bg-[#202020] border border-[#e6e6e6] dark:border-[#333333] rounded-full pl-8 pr-3.5 py-1.5 text-[12px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] w-48 shadow-2xs"
            />
          </div>

          {/* Reset / Default Preset Button */}
          {onLoadPreset && (
            <button
              onClick={() => handleApplyPreset("standard", DEFAULT_STANDARD_CATEGORIES)}
              className="px-3.5 py-2 bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] border border-[#e6e6e6] dark:border-[#383838] text-[#31302e] dark:text-[#d4d4d4] text-[12px] font-semibold rounded-full shadow-2xs flex items-center gap-1.5 cursor-pointer active:scale-97"
              title="Reset all categories to default standard 18-folder taxonomy"
            >
              <RotateCcw className="w-3.5 h-3.5 text-[#0075de] dark:text-[#2383e2]" />
              <span>Reset Defaults</span>
            </button>
          )}

          {/* Add Category Pill Button */}
          <button
            onClick={() => setIsAdding(true)}
            className="px-4 py-2 bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] dark:hover:bg-[#1d70c2] text-white text-[13px] font-semibold rounded-full shadow-xs flex items-center gap-1.5 cursor-pointer active:scale-97"
          >
            <Plus className="w-4 h-4" />
            <span>New Category</span>
          </button>
        </div>
      </div>

      {/* Preset Category Packs Quick Selector */}
      {onLoadPreset && (
        <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-4 shadow-2xs space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#0075de] dark:text-[#2383e2]" />
              <span className="text-[13px] font-bold text-[#000000] dark:text-[#ffffff]">
                Predefined Category Packs
              </span>
              <span className="text-[11px] text-[#615d59] dark:text-[#9b9a97]">
                (1-Click Instant Templates)
              </span>
            </div>
            {justLoadedPreset && (
              <span className="text-[11px] text-[#166534] dark:text-[#4ade80] font-semibold flex items-center gap-1 bg-[#dcfce7] dark:bg-[#052e16] px-2.5 py-0.5 rounded-full">
                <Check className="w-3 h-3" />
                <span>Preset Applied!</span>
              </span>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {PRESET_PACKS.map((pack) => {
              const isApplied = justLoadedPreset === pack.id;
              return (
                <button
                  key={pack.id}
                  onClick={() => handleApplyPreset(pack.id, pack.categories)}
                  className={`text-[12px] px-3 py-1.5 rounded-full border transition-all cursor-pointer flex items-center gap-1.5 active:scale-97 ${
                    isApplied
                      ? "bg-[#0075de] text-white border-[#0075de] font-semibold shadow-xs"
                      : "bg-[#f6f5f4] dark:bg-[#252525] border-[#e6e6e6] dark:border-[#383838] text-[#31302e] dark:text-[#d4d4d4] hover:border-[#0075de] dark:hover:border-[#2383e2] hover:bg-[#e8f4fd] dark:hover:bg-[#0c3966]/30 shadow-2xs"
                  }`}
                  title={`${pack.description} (${Object.keys(pack.categories).length} folders)`}
                >
                  <span>{pack.emoji}</span>
                  <span className="font-medium">{pack.name}</span>
                  <span className="text-[10px] opacity-75 font-mono">
                    ({Object.keys(pack.categories).length})
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Inline Create Form */}
      {isAdding && (
        <form
          onSubmit={handleSave}
          className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#0075de]/30 dark:border-[#2383e2]/40 p-6 shadow-[0_4px_20px_rgba(0,0,0,0.06)] dark:shadow-[0_4px_20px_rgba(0,0,0,0.4)] space-y-4 animate-fade-in"
        >
          <div className="flex items-center justify-between border-b border-[#e6e6e6] dark:border-[#2e2e2e] pb-3">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md bg-[#e8f4fd] dark:bg-[#0c3966]/40 text-[#0075de] dark:text-[#8bc5f8] flex items-center justify-center">
                <FileSearch className="w-3.5 h-3.5" />
              </div>
              <h3 className="text-[15px] font-bold text-[#000000] dark:text-[#ffffff]">Create New Category</h3>
            </div>
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="text-[#a39e98] hover:text-[#000000] dark:hover:text-[#ffffff] cursor-pointer p-1 rounded-md"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[12px] font-semibold text-[#000000] dark:text-[#ffffff] mb-1">
                Category Path / Folder Name <span className="text-[#dd5b00] dark:text-[#fb923c]">*</span>
              </label>
              <input
                type="text"
                required
                value={catName}
                onChange={(e) => setCatName(e.target.value)}
                placeholder="Finance/Tax_Receipts or Work/Client_Alpha"
                className="w-full bg-[#ffffff] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-xs px-3 py-2 text-[13px] font-mono text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:ring-1 focus:ring-[#0075de]"
              />
              <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] mt-1">Creates matching nested subfolders.</p>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#000000] dark:text-[#ffffff] mb-1">
                Description & Criteria
              </label>
              <input
                type="text"
                value={catDesc}
                onChange={(e) => setCatDesc(e.target.value)}
                placeholder="Documents containing invoice IDs, payment terms, receipts"
                className="w-full bg-[#ffffff] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-xs px-3 py-2 text-[13px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:ring-1 focus:ring-[#0075de]"
              />
              <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] mt-1">Explains what files belong in this category.</p>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#000000] dark:text-[#ffffff] mb-1">
                Keywords (comma-separated)
              </label>
              <input
                type="text"
                value={catKeywords}
                onChange={(e) => setCatKeywords(e.target.value)}
                placeholder="invoice, bill, receipt, total, vendor"
                className="w-full bg-[#ffffff] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-xs px-3 py-2 text-[13px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:ring-1 focus:ring-[#0075de]"
              />
              <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] mt-1">Used for fast instant keyword matching.</p>
            </div>

            <div>
              <label className="block text-[12px] font-semibold text-[#000000] dark:text-[#ffffff] mb-1">
                Target Extensions (comma-separated)
              </label>
              <input
                type="text"
                value={catExtensions}
                onChange={(e) => setCatExtensions(e.target.value)}
                placeholder=".pdf, .docx, .xlsx, .csv"
                className="w-full bg-[#ffffff] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-xs px-3 py-2 text-[13px] font-mono text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:ring-1 focus:ring-[#0075de]"
              />
              <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] mt-1">Filters file format candidates.</p>
            </div>
          </div>

          <div className="flex justify-end gap-2.5 pt-3 border-t border-[#e6e6e6] dark:border-[#2e2e2e]">
            <button
              type="button"
              onClick={() => setIsAdding(false)}
              className="px-4 py-2 text-[13px] font-medium text-[#615d59] dark:text-[#9b9a97] hover:text-[#000000] dark:hover:text-[#ffffff] hover:bg-[#f1f0ee] dark:hover:bg-[#282828] rounded-md cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-5 py-2 bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] text-white text-[13px] font-semibold rounded-full shadow-xs cursor-pointer active:scale-97"
            >
              Save Category
            </button>
          </div>
        </form>
      )}

      {/* Empty State */}
      {filteredList.length === 0 && (
        <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-dashed border-[#e6e6e6] dark:border-[#333333] p-12 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-[#e8f4fd] dark:bg-[#0c3966]/40 text-[#0075de] dark:text-[#8bc5f8] flex items-center justify-center mx-auto">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-[16px] font-bold text-[#000000] dark:text-[#ffffff]">
              {searchFilter ? "No matching categories found" : "No predefined categories configured"}
            </h3>
            <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97] max-w-md mx-auto mt-1">
              {searchFilter
                ? `No categories match "${searchFilter}". Clear the search or create a new one.`
                : "Load the standard 18-folder predefined taxonomy or apply an industry preset pack below."}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            {onLoadPreset && (
              <button
                onClick={() => handleApplyPreset("standard", DEFAULT_STANDARD_CATEGORIES)}
                className="px-5 py-2.5 bg-[#0075de] hover:bg-[#005bab] text-white text-[13px] font-semibold rounded-full shadow-xs cursor-pointer active:scale-97 flex items-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                <span>Load Default 18 Categories</span>
              </button>
            )}
            <button
              onClick={() => setIsAdding(true)}
              className="px-5 py-2.5 bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] text-[#31302e] dark:text-[#d4d4d4] text-[13px] font-semibold rounded-full border border-[#e6e6e6] dark:border-[#383838] cursor-pointer active:scale-97 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              <span>Create Custom Category</span>
            </button>
          </div>
        </div>
      )}

      {/* Categories Cards Grid */}
      {filteredList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredList.map(([name, cat]) => {
            const style = getStickerStyle(name);
            return (
              <div
                key={name}
                className={`bg-[#ffffff] dark:bg-[#202020] rounded-xl border transition-all duration-200 p-5 space-y-3 ${
                  cat.active
                    ? "border-[#e6e6e6] dark:border-[#2e2e2e] hover:border-[#a39e98] dark:hover:border-[#4a4a4a] shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)]"
                    : "border-[#e6e6e6]/60 dark:border-[#2e2e2e]/40 opacity-60 bg-[#f6f5f4]/50 dark:bg-[#191919]/50"
                }`}
              >
                {/* Card Top: Tag badge + Active toggle + Delete */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-[12px] font-semibold px-2.5 py-1 rounded-md border flex items-center gap-1.5 font-mono ${style.bg} ${style.text} ${style.border}`}
                    >
                      <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                      <span>{name}</span>
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <label className="flex items-center cursor-pointer" title={cat.active ? "Enabled" : "Disabled"}>
                      <input
                        type="checkbox"
                        checked={cat.active}
                        onChange={() => onToggleCategory(name)}
                        className="w-4 h-4 rounded text-[#0075de] dark:text-[#2383e2] focus:ring-[#0075de] cursor-pointer accent-[#0075de]"
                      />
                    </label>
                    <button
                      onClick={() => onDeleteCategory(name)}
                      title="Delete category"
                      className="text-[#a39e98] hover:text-[#9d174d] dark:hover:text-[#f472b6] hover:bg-[#fdeef8] dark:hover:bg-[#4d0c36]/40 p-1.5 rounded-md transition cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Description */}
                <p className="text-[13px] text-[#615d59] dark:text-[#9b9a97] line-clamp-2 leading-relaxed min-h-[38px]">
                  {cat.description || "No description provided."}
                </p>

                {/* Keywords & Extension Chips */}
                <div className="space-y-2 pt-2 border-t border-[#e6e6e6]/80 dark:border-[#2e2e2e] text-[11px]">
                  {cat.keywords && cat.keywords.length > 0 && (
                    <div>
                      <span className="text-[#a39e98] font-medium block mb-1">Keywords:</span>
                      <div className="flex flex-wrap gap-1">
                        {cat.keywords.slice(0, 5).map((kw, i) => (
                          <span
                            key={i}
                            className="bg-[#f1f0ee] dark:bg-[#282828] text-[#31302e] dark:text-[#d4d4d4] px-2 py-0.5 rounded-sm font-mono border border-transparent dark:border-[#383838]"
                          >
                            {kw}
                          </span>
                        ))}
                        {cat.keywords.length > 5 && (
                          <span className="text-[#a39e98] self-center px-1 font-mono">
                            +{cat.keywords.length - 5}
                          </span>
                        )}
                      </div>
                    </div>
                  )}

                  {cat.extensions && cat.extensions.length > 0 && (
                    <div className="flex items-center gap-1.5 font-mono text-[#615d59] dark:text-[#9b9a97]">
                      <FileCode className="w-3 h-3 text-[#a39e98]" />
                      <span>{cat.extensions.join(", ")}</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
