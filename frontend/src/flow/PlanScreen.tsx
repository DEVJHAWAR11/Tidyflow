import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  Loader2,
  Pencil,
  Trash2,
  Plus,
  PenLine,
  CornerDownRight,
  ArrowLeft,
  ArrowRight,
  SlidersHorizontal, RefreshCw } from "lucide-react";
import { WizardStatus } from "../wizard/scenes";
import type { PlanScreenProps } from "./contracts";
import type { ComplexityLevel } from "../types";
import { Screen, Card, Button, StepHeader, Skeleton, ease } from "./ui";
import { FolderIcon } from "./icons";
import {
  folderLabel,
  folderGroup,
  prettyFolderName,
  toFolderName,
} from "../utils/folderVisuals";

const DETAIL_OPTIONS: { id: ComplexityLevel; label: string }[] = [
  { id: "low", label: "Fewer" },
  { id: "medium", label: "Balanced" },
  { id: "high", label: "Detailed" },
];

export function PlanScreen(props: PlanScreenProps) {
  const [editingName, setEditingName] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [refineText, setRefineText] = useState("");

  const activeCategories = Object.values(props.categories || {}).filter((c) => c.active);

  const startRenaming = (catName: string) => {
    setEditingName(catName);
    setEditValue(prettyFolderName(catName));
  };

  const handleSaveRename = (originalName: string) => {
    const clean = toFolderName(editValue);
    if (clean && clean !== originalName) {
      props.onRename(originalName, clean);
    }
    setEditingName(null);
  };

  const handleAddFolder = () => {
    const clean = toFolderName(newFolderName);
    if (!clean) return;
    const exists = Object.keys(props.categories || {}).some(
      (k) => k.toLowerCase() === clean.toLowerCase()
    );
    if (!exists) {
      props.onAdd(clean);
    }
    setIsAdding(false);
    setNewFolderName("");
  };

  const handleRefineSubmit = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || props.isRefining) return;
    props.onRefine(trimmed);
    setRefineText("");
  };

  return (
    <Screen className="max-w-[960px] mx-auto pt-8 pb-16 px-4">
      {/* Header Row */}
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <StepHeader
          eyebrow={`Step 2 of 3 · ${folderLabel(props.inputFolder)}`}
          title="Proposed folders"
          subtitle="Based on what's in the folder. Rename, remove or add folders — nothing changes until you approve."
        />
        <div className="flex flex-col gap-1.5 md:items-end shrink-0">
          <span className="text-[12px] text-tf-muted">Detail</span>
          <div className="inline-flex bg-tf-surface-2 p-0.5 rounded-[9px] border border-tf-border">
            {DETAIL_OPTIONS.map((opt) => {
              const isSelected = props.complexityLevel === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  disabled={props.isGenerating || props.isRefining}
                  onClick={() => props.onChangeDetail(opt.id)}
                  className={`h-7 px-3 text-[13px] font-medium rounded-[7px] transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    isSelected
                      ? "bg-tf-surface text-tf-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                      : "text-tf-muted hover:text-tf-ink"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Notices */}
      {props.aiError && !props.isGenerating && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-[10px] border border-tf-border bg-tf-surface px-4 py-3 text-[13.5px]">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle size={16} strokeWidth={1.75} className="text-tf-warn shrink-0" />
            <span className="text-tf-ink truncate">
              <span className="font-semibold">Basic suggestions.</span>{" "}
              <span className="text-tf-muted">{props.aiError}</span>
            </span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={props.onOpenSettings}
            className="shrink-0 ml-auto"
          >
            Open Settings
          </Button>
        </div>
      )}
      {!props.aiError && props.planIsBasic && props.hasLlmKey && !props.isGenerating && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-[10px] border border-tf-border bg-tf-surface px-4 py-3 text-[13.5px]">
          <div className="flex items-center gap-3 min-w-0">
            <RefreshCw size={16} strokeWidth={1.75} className="text-tf-muted shrink-0" />
            <span className="text-tf-ink">
              <span className="font-semibold">These folders were made without AI.</span>{" "}
              <span className="text-tf-muted">Smart sorting works now, so it can propose a better set.</span>
            </span>
          </div>
          <Button variant="primary" size="sm" onClick={props.onRegenerate} className="shrink-0 ml-auto">
            Propose again
          </Button>
        </div>
      )}

      {props.planError && (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-[10px] border border-tf-border bg-tf-surface px-4 py-3 text-[13.5px]">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle size={16} strokeWidth={1.75} className="text-tf-danger shrink-0" />
            <span className="text-tf-danger truncate font-medium">{props.planError}</span>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={props.onRegenerate}
            className="shrink-0 ml-auto"
          >
            Try again
          </Button>
        </div>
      )}

      {/* The wizard reads the folder, then casts the plan */}
      <WizardStatus active={props.isGenerating} label="Reading your files…" />

      {/* Generating State */}
      {props.isGenerating ? (
        <div className="mt-4 space-y-3">
          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="p-4 flex gap-3.5 items-start min-h-[92px]">
                <Skeleton className="w-10 h-10 rounded-[10px] shrink-0" />
                <div className="flex-1 space-y-2 pt-0.5 min-w-0">
                  <Skeleton className="h-4 w-3/4 rounded-[4px]" />
                  <Skeleton className="h-3 w-full rounded-[4px]" />
                  <Skeleton className="h-3 w-1/2 rounded-[4px]" />
                </div>
              </Card>
            ))}
          </div>
        </div>
      ) : (
        <>
          {/* Empty State */}
          {activeCategories.length === 0 && !props.planError ? (
            <Card className="mt-6 p-10 text-center flex flex-col items-center justify-center gap-3 max-w-lg mx-auto">
              <FolderIcon name="" glyph={false} size={40} />
              <div>
                <h3 className="text-[15px] font-medium text-tf-ink">No folders yet</h3>
                <p className="text-[13.5px] text-tf-muted mt-1 leading-relaxed">
                  Let TidyFlow look through the folder and propose some.
                </p>
              </div>
              <Button variant="primary" size="md" onClick={props.onRegenerate}>
                Propose folders
              </Button>
            </Card>
          ) : (
            /* Folder Grid */
            <div className="mt-6 grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
              <AnimatePresence mode="popLayout">
                {activeCategories.map((cat) => (
                  <motion.div
                    key={cat.name}
                    layout
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.18, ease } }}
                    transition={{ duration: 0.18, ease }}
                  >
                    <Card className="p-4 flex gap-3.5 items-start group relative hover:border-tf-border-strong hover:shadow-[var(--shadow-tf-lift)] transition-colors min-h-[92px] h-full">
                      <FolderIcon name={cat.name} size={40} />
                      <div className="min-w-0 flex-1 pr-12">
                        {folderGroup(cat.name) && (
                          <div className="text-[12px] text-tf-faint truncate">
                            in {folderGroup(cat.name)}
                          </div>
                        )}
                        {editingName === cat.name ? (
                          <input
                            autoFocus
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") handleSaveRename(cat.name);
                              if (e.key === "Escape") setEditingName(null);
                            }}
                            onBlur={() => handleSaveRename(cat.name)}
                            className="h-7 px-2 text-[14px] font-medium text-tf-ink bg-tf-surface border border-tf-border-strong rounded-[8px] focus:outline-none focus:border-tf-ink focus:ring-1 focus:ring-tf-ink w-full"
                          />
                        ) : (
                          <h3
                            className="text-[14.5px] font-medium text-tf-ink truncate"
                            title={prettyFolderName(cat.name)}
                          >
                            {prettyFolderName(cat.name)}
                          </h3>
                        )}
                        {cat.description && (
                          <p className="text-[13px] text-tf-muted line-clamp-2 mt-0.5 leading-relaxed">
                            {cat.description}
                          </p>
                        )}
                      </div>

                      {/* Actions Top-Right */}
                      <div className="absolute top-2.5 right-2.5 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                        <button
                          type="button"
                          aria-label="Rename folder"
                          title="Rename folder"
                          onClick={() => startRenaming(cat.name)}
                          className="w-7 h-7 rounded-[7px] flex items-center justify-center text-tf-muted hover:text-tf-ink hover:bg-tf-surface-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tf-ink"
                        >
                          <Pencil size={14} strokeWidth={1.75} />
                        </button>
                        <button
                          type="button"
                          aria-label="Remove folder"
                          title="Remove folder"
                          onClick={() => props.onRemove(cat.name)}
                          className="w-7 h-7 rounded-[7px] flex items-center justify-center text-tf-muted hover:text-tf-danger hover:bg-tf-surface-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tf-danger"
                        >
                          <Trash2 size={14} strokeWidth={1.75} />
                        </button>
                      </div>
                    </Card>
                  </motion.div>
                ))}
              </AnimatePresence>

              {/* New Folder Tile */}
              {isAdding ? (
                <motion.div
                  layout
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.18, ease } }}
                  transition={{ duration: 0.18, ease }}
                >
                  <Card className="p-4 min-h-[92px] h-full flex flex-col justify-between gap-3 border-tf-border-strong">
                    <input
                      autoFocus
                      type="text"
                      placeholder="Folder name"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleAddFolder();
                        if (e.key === "Escape") {
                          setIsAdding(false);
                          setNewFolderName("");
                        }
                      }}
                      className="h-8 px-2.5 text-[13.5px] bg-tf-surface border border-tf-border-strong rounded-[8px] text-tf-ink placeholder:text-tf-faint focus:outline-none focus:border-tf-ink focus:ring-1 focus:ring-tf-ink w-full"
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setIsAdding(false);
                          setNewFolderName("");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={handleAddFolder}
                        disabled={!newFolderName.trim()}
                      >
                        Add
                      </Button>
                    </div>
                  </Card>
                </motion.div>
              ) : (
                <motion.div
                  layout
                  transition={{ duration: 0.18, ease }}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsAdding(true);
                      setNewFolderName("");
                    }}
                    className="w-full h-full min-h-[92px] rounded-[14px] border border-dashed border-tf-border-strong hover:border-tf-faint hover:bg-tf-surface-2/60 flex items-center justify-center gap-2 text-[13.5px] font-medium text-tf-muted transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tf-ink"
                  >
                    <Plus size={15} strokeWidth={1.75} />
                    <span>New folder</span>
                  </button>
                </motion.div>
              )}
            </div>
          )}

          {/* Change Request Card */}
          {props.hasLlmKey && activeCategories.length > 0 && (
            <Card className="mt-5 p-3">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleRefineSubmit(refineText);
                }}
                className="flex items-center gap-2.5"
              >
                <PenLine size={16} strokeWidth={1.75} className="text-tf-muted shrink-0 ml-1" />
                <input
                  type="text"
                  value={refineText}
                  onChange={(e) => setRefineText(e.target.value)}
                  disabled={props.isRefining}
                  placeholder='Describe a change, e.g. “Merge everything about courses into one folder”'
                  className="flex-1 bg-transparent text-[14px] text-tf-ink placeholder:text-tf-faint focus:outline-none disabled:opacity-50"
                />
                <Button
                  type="submit"
                  variant="secondary"
                  size="sm"
                  disabled={!refineText.trim() || props.isRefining}
                  icon={props.isRefining ? <Loader2 size={14} className="animate-spin" /> : undefined}
                >
                  {props.isRefining ? "Applying…" : "Apply"}
                </Button>
              </form>

              <div className="mt-2.5 pt-2.5 border-t border-tf-border flex flex-wrap items-center gap-2">
                {(
                  [
                    "Fewer, broader folders",
                    "Split by year",
                    "Separate work and personal",
                  ] as const
                ).map((chip) => (
                  <button
                    key={chip}
                    type="button"
                    disabled={props.isRefining}
                    onClick={() => handleRefineSubmit(chip)}
                    className="h-7 px-2.5 rounded-[7px] border border-tf-border text-[12.5px] text-tf-ink-2 hover:bg-tf-surface-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {chip}
                  </button>
                ))}
              </div>

              <AnimatePresence>
                {props.assistantNote && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.2, ease }}
                    className="overflow-hidden"
                  >
                    <div className="mt-2.5 pt-2.5 border-t border-tf-border flex items-start gap-2 text-[13px] text-tf-ink-2 leading-relaxed">
                      <CornerDownRight size={14} strokeWidth={1.75} className="text-tf-faint shrink-0 mt-0.5" />
                      <span>{props.assistantNote}</span>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </Card>
          )}
        </>
      )}

      {/* Sticky Bottom Action Bar */}
      <div className="sticky bottom-5 z-30 mt-8">
        <Card className="px-3 py-2 pl-3 flex items-center justify-between gap-3 bg-tf-surface/90 backdrop-blur-md shadow-[var(--shadow-tf-float)] border-tf-border-strong">
          <div>
            <Button
              variant="ghost"
              size="md"
              icon={<ArrowLeft size={15} strokeWidth={1.75} />}
              onClick={props.onBack}
            >
              Back
            </Button>
          </div>

          <div className="text-[13px] text-tf-muted tf-num hidden sm:block">
            {activeCategories.length} {activeCategories.length === 1 ? "folder" : "folders"}
          </div>

          <div className="flex items-center gap-2.5">
            {props.advancedMode && (
              <Button
                variant="ghost"
                size="sm"
                icon={<SlidersHorizontal size={15} strokeWidth={1.75} />}
                onClick={props.onOpenAdvancedEditor}
              >
                Advanced editor
              </Button>
            )}
            <Button
              variant="primary"
              size="md"
              iconRight={<ArrowRight size={15} strokeWidth={1.75} />}
              onClick={props.onStart}
              disabled={activeCategories.length === 0 || props.isGenerating || props.isRefining}
            >
              Sort files
            </Button>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
