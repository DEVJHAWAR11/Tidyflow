import React from "react";
import { FtsResultItem } from "../types";
import { getStickerStyle } from "../utils/stickerTheme";
import { Search, FileText, CornerDownLeft } from "lucide-react";

interface SearchViewProps {
  ftsQuery: string;
  setFtsQuery: (val: string) => void;
  ftsResults: FtsResultItem[];
  isSearching: boolean;
  onSearch: () => void;
}

export const SearchView: React.FC<SearchViewProps> = ({
  ftsQuery,
  setFtsQuery,
  ftsResults,
  isSearching,
  onSearch,
}) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      onSearch();
    }
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl mx-auto">
      {/* Header Bar */}
      <div className="border-b border-[#e6e6e6] dark:border-[#2e2e2e] pb-4">
        <div className="flex items-center gap-2 text-[13px] text-[#615d59] dark:text-[#9b9a97] mb-1 font-medium">
          <span>Workspace</span>
          <span>/</span>
          <span className="text-[#000000] dark:text-[#ffffff]">Search</span>
        </div>
        <h2 className="text-3xl font-bold text-[#000000] dark:text-[#ffffff] tracking-heading-1">
          Search Index
        </h2>
        <p className="text-[15px] text-[#615d59] dark:text-[#9b9a97] mt-1">
          Search indexed document body text, OCR transcriptions, and file paths.
        </p>
      </div>

      {/* Search Bar Card */}
      <div className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] space-y-3">
        <div className="flex gap-2.5">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-[#a39e98] absolute left-3.5 top-3.5" />
            <input
              type="text"
              value={ftsQuery}
              onChange={(e) => setFtsQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search across all extracted documents (e.g. invoice, total, React, resume)..."
              className="w-full bg-[#f6f5f4] dark:bg-[#191919] border border-[#e6e6e6] dark:border-[#333333] rounded-md pl-10 pr-4 py-2.5 text-[13px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2] focus:bg-[#ffffff] dark:focus:bg-[#191919] shadow-2xs"
            />
          </div>

          <button
            onClick={onSearch}
            disabled={isSearching || !ftsQuery.trim()}
            className={`px-5 py-2.5 rounded-full text-[13px] font-semibold flex items-center gap-2 transition cursor-pointer ${
              isSearching || !ftsQuery.trim()
                ? "bg-[#e6e6e6] dark:bg-[#333333] text-[#a39e98] cursor-not-allowed"
                : "bg-[#0075de] dark:bg-[#2383e2] hover:bg-[#005bab] text-white active:scale-97 shadow-xs"
            }`}
          >
            <span>{isSearching ? "Searching..." : "Search Index"}</span>
            <CornerDownLeft className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2 text-[12px] text-[#615d59] dark:text-[#9b9a97]">
          <span className="font-medium">Sample queries:</span>
          {["Invoice", "Receipt", "Statement", "Agreement", "Tax", "Draft"].map((sample) => (
            <button
              key={sample}
              onClick={() => {
                setFtsQuery(sample);
              }}
              className="px-2 py-0.5 rounded-sm bg-[#f6f5f4] dark:bg-[#282828] hover:bg-[#eae8e5] dark:hover:bg-[#333333] text-[#31302e] dark:text-[#d4d4d4] border border-[#e6e6e6] dark:border-[#383838] cursor-pointer"
            >
              {sample}
            </button>
          ))}
        </div>
      </div>

      {/* Results Section */}
      {ftsResults.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between text-[12px] font-semibold uppercase tracking-eyebrow text-[#615d59] dark:text-[#9b9a97]">
            <span>Search Results ({ftsResults.length})</span>
          </div>

          <div className="space-y-3">
            {ftsResults.map((item, idx) => {
              const fileName = item.path.split("/").pop() || item.path;
              const catStyle = getStickerStyle(item.category || "");
              return (
                <div
                  key={idx}
                  className="bg-[#ffffff] dark:bg-[#202020] rounded-xl border border-[#e6e6e6] dark:border-[#2e2e2e] p-4.5 space-y-2.5 shadow-[0_1px_3px_rgba(0,0,0,0.02)] dark:shadow-[0_1px_3px_rgba(0,0,0,0.3)] hover:border-[#a39e98] dark:hover:border-[#4a4a4a] transition"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="w-4 h-4 text-[#0075de] dark:text-[#2383e2] shrink-0" />
                      <span className="font-semibold text-[13px] text-[#000000] dark:text-[#ffffff] font-mono truncate">
                        {fileName}
                      </span>
                    </div>

                    {item.category && (
                      <span
                        className={`text-[11px] font-semibold px-2 py-0.5 rounded-md border font-mono ${catStyle.bg} ${catStyle.text} ${catStyle.border}`}
                      >
                        {item.category}
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-[#615d59] dark:text-[#9b9a97] font-mono truncate">
                    {item.path}
                  </p>

                  {item.extracted_text && (
                    <div className="bg-[#f6f5f4] dark:bg-[#191919] p-3 rounded-lg border border-[#e6e6e6] dark:border-[#2e2e2e] font-mono text-[12px] text-[#31302e] dark:text-[#d4d4d4] line-clamp-3 leading-relaxed whitespace-pre-wrap">
                      {item.extracted_text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
