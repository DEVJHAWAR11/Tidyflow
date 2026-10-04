import { useState, useMemo, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  Check,
  FolderInput,
  SquareArrowOutUpRight,
  CornerUpLeft,
  FolderCheck,
  Loader2,
  Table2,
  ArrowLeft,
  ArrowRight,
} from "lucide-react";
import type { PreviewScreenProps } from "./contracts";
import type { ClassifiedFile } from "../types";
import { Screen, Button, Card, StepHeader, SectionTitle, ease } from "./ui";
import { FolderIcon, FilePreview } from "./icons";
import {
  prettyFolderName,
  formatBytes,
  folderLabel,
} from "../utils/folderVisuals";

export function PreviewScreen(props: PreviewScreenProps) {
  const [collapsedMap, setCollapsedMap] = useState<Record<string, boolean>>({});
  const [activeMoveFileId, setActiveMoveFileId] = useState<string | null>(null);
  // Unsure files the user explicitly chose to leave where they are.
  const [leftIds, setLeftIds] = useState<Set<string>>(() => new Set());
  // Long review lists are capped; the rest is one click away.
  const REVIEW_PAGE = 12;
  const [reviewLimit, setReviewLimit] = useState(REVIEW_PAGE);

  const leaveInPlace = (ids: string[]) => {
    setLeftIds((prev) => new Set([...prev, ...ids]));
    ids.forEach((id) => props.onSetIncluded(id, false));
  };

  const undoLeave = (id: string) => {
    setLeftIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  // Close the move popover on Escape or a click outside it
  useEffect(() => {
    if (!activeMoveFileId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setActiveMoveFileId(null);
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as Element | null)?.closest("[data-move-popover]")) {
        setActiveMoveFileId(null);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [activeMoveFileId]);

  const effective = (f: ClassifiedFile) =>
    props.categoryOverrides[f.file_id] ?? f.category;

  const { sureFiles, unsureFiles } = useMemo(() => {
    const sure: ClassifiedFile[] = [];
    const unsure: ClassifiedFile[] = [];

    for (const f of props.files) {
      const hasOverride = props.categoryOverrides[f.file_id] !== undefined;
      const eff = props.categoryOverrides[f.file_id] ?? f.category;
      const isUnsure =
        !hasOverride &&
        (eff === "Unknown" ||
          f.confidence < props.autoThreshold ||
          !props.folders.includes(eff));

      if (isUnsure) {
        unsure.push(f);
      } else {
        sure.push(f);
      }
    }

    return { sureFiles: sure, unsureFiles: unsure };
  }, [props.files, props.categoryOverrides, props.autoThreshold, props.folders]);

  const includedCount = useMemo(() => {
    return props.files.filter((f) => props.selectedFileIds.has(f.file_id)).length;
  }, [props.files, props.selectedFileIds]);

  const { folderGroups, emptyFolders } = useMemo(() => {
    const groups: { folder: string; files: ClassifiedFile[] }[] = [];
    const empty: string[] = [];

    for (const folder of props.folders) {
      const matching = sureFiles.filter((f) => effective(f) === folder);
      if (matching.length > 0) {
        groups.push({ folder, files: matching });
      } else {
        empty.push(folder);
      }
    }

    // Include any folders formed by overrides not already in `folders`
    const knownSet = new Set(props.folders);
    const extraFolders = new Set<string>();
    for (const f of sureFiles) {
      const eff = effective(f);
      if (!knownSet.has(eff)) {
        extraFolders.add(eff);
      }
    }
    for (const extra of extraFolders) {
      const matching = sureFiles.filter((f) => effective(f) === extra);
      if (matching.length > 0) {
        groups.push({ folder: extra, files: matching });
      }
    }

    return { folderGroups: groups, emptyFolders: empty };
  }, [props.folders, sureFiles, props.categoryOverrides]);

  const sortedUnsureFiles = useMemo(() => {
    return [...unsureFiles].sort((a, b) => {
      const aLeft = leftIds.has(a.file_id);
      const bLeft = leftIds.has(b.file_id);
      if (aLeft === bLeft) return 0;
      return aLeft ? 1 : -1;
    });
  }, [unsureFiles, leftIds]);

  const undecidedIds = useMemo(() => {
    return sortedUnsureFiles
      .filter((f) => !leftIds.has(f.file_id))
      .map((f) => f.file_id);
  }, [sortedUnsureFiles, leftIds]);

  const isFolderExpanded = (folder: string, fileCount: number) => {
    if (collapsedMap[folder] !== undefined) {
      return !collapsedMap[folder];
    }
    return fileCount <= 6;
  };

  const toggleFolderExpanded = (folder: string, fileCount: number) => {
    const current = isFolderExpanded(folder, fileCount);
    setCollapsedMap((prev) => ({ ...prev, [folder]: current }));
  };

  return (
    <Screen className="max-w-[960px] mx-auto pt-8 pb-16 px-4 space-y-8">
      {/* Notices */}
      {props.aiError && unsureFiles.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-tf-border bg-tf-surface px-4 py-3 text-[13.5px]">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle size={16} strokeWidth={1.75} className="text-tf-warn shrink-0" />
            <span className="text-tf-ink truncate">
              <span className="font-semibold">Smart sorting couldn't run</span>, so more files need your review.{" "}
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

      {props.isStale && (
        <div className="flex items-center justify-between gap-3 rounded-[10px] border border-tf-border bg-tf-surface px-4 py-3 text-[13.5px]">
          <div className="flex items-center gap-3 min-w-0">
            <RefreshCw size={16} strokeWidth={1.75} className="text-tf-warn shrink-0" />
            <span className="text-tf-ink truncate font-medium">
              Your folder plan changed after these files were sorted.
            </span>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={props.onResort}
            className="shrink-0 ml-auto"
          >
            Sort again
          </Button>
        </div>
      )}

      {/* Main Content Area (dimmed if stale) */}
      <div
        className={`space-y-8 transition-opacity duration-200 ${
          props.isStale ? "opacity-60 pointer-events-none select-none" : ""
        }`}
      >
        {/* Header Block */}
        <div>
          <StepHeader
            eyebrow="Step 3 of 3"
            title={`Review where ${props.files.length} files will go`}
            subtitle="Files you leave unchecked stay where they are."
          />

          <div className="mt-3 text-[13px] text-tf-muted tf-num flex items-center gap-2">
            <span>{sureFiles.length} sorted</span>
            <span>·</span>
            <span className={unsureFiles.length > 0 ? "text-tf-warn font-medium" : ""}>
              {unsureFiles.length} to review
            </span>
            <span>·</span>
            <span>
              {folderGroups.length} {folderGroups.length === 1 ? "folder" : "folders"}
            </span>
          </div>
        </div>

        {/* To Review Section */}
        {unsureFiles.length > 0 && (
          <section className="space-y-3">
            <SectionTitle
              aside={
                undecidedIds.length > 1 ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => leaveInPlace(undecidedIds)}
                  >
                    Leave the rest
                  </Button>
                ) : undefined
              }
            >
              To review
            </SectionTitle>

            <Card className="divide-y divide-tf-border overflow-visible">
              <AnimatePresence mode="popLayout">
                {sortedUnsureFiles.slice(0, reviewLimit).map((f) => {
                  const isLeftInPlace = leftIds.has(f.file_id);
                  const reason = f.reason && f.reason !== props.aiError ? f.reason : "";
                  const hasGuess =
                    f.category !== "Unknown" && props.folders.includes(f.category);
                  const isMoveOpen = activeMoveFileId === f.file_id;

                  return (
                    <motion.div
                      key={f.file_id}
                      layout
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.18, ease } }}
                      transition={{ duration: 0.18, ease }}
                      className={`min-h-14 px-4 py-2.5 flex items-center gap-3 transition-opacity ${
                        isLeftInPlace ? "opacity-60" : ""
                      }`}
                    >
                      <FilePreview
                        size={32}
                        extension={f.extension}
                        fileCategory={f.file_category}
                        thumbnailB64={f.thumbnail_b64}
                      />

                      <div className="min-w-0 flex-1">
                        <div
                          className="text-[13.5px] font-medium text-tf-ink truncate"
                          title={f.filename}
                        >
                          {f.filename}
                        </div>
                        <div className="text-[12px] text-tf-muted truncate tf-num">
                          {reason ? `${reason} · ` : ""}
                          {formatBytes(f.file_size_bytes)}
                        </div>
                      </div>

                      {/* Right side actions */}
                      {isLeftInPlace ? (
                        <div className="shrink-0 flex items-center gap-2 text-[12.5px] text-tf-muted">
                          <span>Left in place</span>
                          <span>·</span>
                          <button
                            type="button"
                            onClick={() => undoLeave(f.file_id)}
                            className="text-tf-brand font-medium hover:underline cursor-pointer"
                          >
                            Undo
                          </button>
                        </div>
                      ) : (
                        <div className="shrink-0 flex items-center gap-2">
                          {hasGuess && (
                            <Button
                              variant="secondary"
                              size="sm"
                              title="Put it here"
                              icon={<FolderIcon name={f.category} size={18} />}
                              onClick={() => {
                                props.onMoveFile(f.file_id, f.category);
                                props.onSetIncluded(f.file_id, true);
                              }}
                            >
                              {prettyFolderName(f.category)}
                            </Button>
                          )}

                          <div data-move-popover className="relative">
                            <Button
                              variant="secondary"
                              size="sm"
                              iconRight={<ChevronDown size={14} strokeWidth={1.75} />}
                              onClick={() =>
                                setActiveMoveFileId(isMoveOpen ? null : f.file_id)
                              }
                            >
                              Choose…
                            </Button>

                            {isMoveOpen && (
                              <Card className="absolute right-0 top-9 z-50 w-56 p-1 shadow-[var(--shadow-tf-float)] border-tf-border-strong bg-tf-surface max-h-64 overflow-y-auto">
                                <div className="text-[11.5px] font-medium text-tf-faint px-2 py-1">
                                  Move to
                                </div>
                                {props.folders.map((folder) => (
                                  <button
                                    key={folder}
                                    type="button"
                                    onClick={() => {
                                      props.onMoveFile(f.file_id, folder);
                                      props.onSetIncluded(f.file_id, true);
                                      setActiveMoveFileId(null);
                                    }}
                                    className="w-full h-8 px-2 rounded-[7px] hover:bg-tf-surface-2 flex items-center gap-2 text-[13px] text-tf-ink text-left transition-colors cursor-pointer"
                                  >
                                    <FolderIcon name={folder} size={20} />
                                    <span className="truncate">{prettyFolderName(folder)}</span>
                                  </button>
                                ))}
                                <div className="h-px bg-tf-border my-1" />
                                <button
                                  type="button"
                                  onClick={() => {
                                    leaveInPlace([f.file_id]);
                                    setActiveMoveFileId(null);
                                  }}
                                  className="w-full h-8 px-2 rounded-[7px] hover:bg-tf-surface-2 flex items-center gap-2 text-[13px] text-tf-muted text-left transition-colors cursor-pointer"
                                >
                                  <CornerUpLeft
                                    size={14}
                                    strokeWidth={1.75}
                                    className="text-tf-muted shrink-0"
                                  />
                                  <span>Leave in place</span>
                                </button>
                              </Card>
                            )}
                          </div>
                        </div>
                      )}
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {sortedUnsureFiles.length > reviewLimit && (
                <div className="px-4 py-2.5 flex items-center justify-between gap-3">
                  <span className="text-[13px] text-tf-muted tf-num">
                    Showing {reviewLimit} of {sortedUnsureFiles.length}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setReviewLimit((n) => n + REVIEW_PAGE * 4)}
                  >
                    Show more
                  </Button>
                </div>
              )}
            </Card>
          </section>
        )}

        {/* Sorted Section */}
        <section className="space-y-3">
          <SectionTitle>Sorted</SectionTitle>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {folderGroups.map((group) => {
              const expanded = isFolderExpanded(group.folder, group.files.length);

              return (
                <Card key={group.folder} className="overflow-visible">
                  {/* Header button row */}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => toggleFolderExpanded(group.folder, group.files.length)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleFolderExpanded(group.folder, group.files.length);
                      }
                    }}
                    className="px-4 py-3 flex items-center justify-between gap-3 cursor-pointer select-none hover:bg-tf-surface-2/40 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <FolderIcon name={group.folder} size={34} />
                      <div className="min-w-0">
                        <div className="text-[14px] font-medium text-tf-ink truncate">
                          {prettyFolderName(group.folder)}
                        </div>
                        <div className="text-[12.5px] text-tf-muted tf-num">
                          {group.files.length} {group.files.length === 1 ? "file" : "files"}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {/* Overlapping file preview thumbnails */}
                      <div className="flex items-center">
                        {group.files.slice(0, 3).map((file, idx) => (
                          <FilePreview
                            key={file.file_id}
                            extension={file.extension}
                            fileCategory={file.file_category}
                            thumbnailB64={file.thumbnail_b64}
                            size={18}
                            className={idx > 0 ? "-ml-1.5" : ""}
                          />
                        ))}
                      </div>

                      <ChevronDown
                        size={16}
                        strokeWidth={1.75}
                        className={`text-tf-faint transition-transform duration-200 ${
                          expanded ? "rotate-180" : ""
                        }`}
                      />
                    </div>
                  </div>

                  {/* Expanded rows */}
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{
                          height: "auto",
                          opacity: 1,
                          transitionEnd: { overflow: "visible" },
                        }}
                        exit={{ height: 0, opacity: 0, overflow: "hidden" }}
                        transition={{ duration: 0.18, ease }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-tf-border divide-y divide-tf-border">
                          {group.files.map((f) => {
                            const isIncluded = props.selectedFileIds.has(f.file_id);
                            const isMoveOpen = activeMoveFileId === f.file_id;
                            const hasRename =
                              props.renamesEnabled &&
                              Boolean(
                                f.suggested_filename &&
                                  f.suggested_filename !== f.filename
                              );

                            return (
                              <div
                                key={f.file_id}
                                className="min-h-10 px-4 py-1.5 flex items-center gap-3 hover:bg-tf-surface-2/60 group transition-colors"
                              >
                                {/* Checkbox */}
                                <button
                                  type="button"
                                  role="checkbox"
                                  aria-checked={isIncluded}
                                  aria-label={`Include ${f.filename}`}
                                  onClick={() =>
                                    props.onSetIncluded(f.file_id, !isIncluded)
                                  }
                                  className={`w-4 h-4 rounded-[4px] flex items-center justify-center shrink-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tf-ink ${
                                    isIncluded
                                      ? "bg-tf-primary text-tf-on-primary"
                                      : "border border-tf-border-strong bg-tf-surface hover:border-tf-border-strong"
                                  }`}
                                >
                                  {isIncluded && <Check size={11} strokeWidth={3} />}
                                </button>

                                <FilePreview
                                  size={20}
                                  extension={f.extension}
                                  fileCategory={f.file_category}
                                  thumbnailB64={f.thumbnail_b64}
                                />

                                {/* Filename & Renamed Hint */}
                                <div className="flex-1 min-w-0">
                                  <div
                                    className={`text-[13px] truncate ${
                                      isIncluded
                                        ? "text-tf-ink"
                                        : "text-tf-faint line-through decoration-tf-faint"
                                    }`}
                                    title={f.filename}
                                  >
                                    {f.filename}
                                  </div>
                                  {hasRename && (
                                    <div className="text-[12px] text-tf-brand-ink truncate flex items-center gap-1">
                                      <ArrowRight size={11} strokeWidth={2} className="shrink-0" />
                                      <span className="truncate">{f.suggested_filename}</span>
                                    </div>
                                  )}
                                </div>

                                {/* File Size */}
                                <span className="text-[12px] font-mono text-tf-faint hidden sm:inline shrink-0 tf-num">
                                  {formatBytes(f.file_size_bytes)}
                                </span>

                                {/* Hover actions */}
                                <div
                                  data-move-popover
                                  className={`relative shrink-0 flex items-center gap-1 transition-opacity ${
                                    isMoveOpen
                                      ? "opacity-100"
                                      : "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    aria-label="Move to another folder"
                                    title="Move to another folder"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setActiveMoveFileId(
                                        isMoveOpen ? null : f.file_id
                                      );
                                    }}
                                    className="w-[26px] h-[26px] rounded-[6px] flex items-center justify-center text-tf-muted hover:text-tf-ink hover:bg-tf-surface-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tf-ink"
                                  >
                                    <FolderInput size={14} strokeWidth={1.75} />
                                  </button>

                                  {isMoveOpen && (
                                    <Card className="absolute right-0 top-7 z-50 w-56 p-1 shadow-[var(--shadow-tf-float)] border-tf-border-strong bg-tf-surface max-h-56 overflow-y-auto">
                                      <div className="text-[11.5px] font-medium text-tf-faint px-2 py-1">
                                        Move to
                                      </div>
                                      {props.folders.map((folder) => {
                                        const isCurrent = effective(f) === folder;
                                        return (
                                          <button
                                            key={folder}
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              props.onMoveFile(f.file_id, folder);
                                              setActiveMoveFileId(null);
                                            }}
                                            className={`w-full h-8 px-2 rounded-[7px] flex items-center gap-2 text-[13px] text-left transition-colors cursor-pointer ${
                                              isCurrent
                                                ? "bg-tf-surface-3 text-tf-ink font-medium"
                                                : "hover:bg-tf-surface-2 text-tf-ink"
                                            }`}
                                          >
                                            <FolderIcon name={folder} size={20} />
                                            <span className="truncate">
                                              {prettyFolderName(folder)}
                                            </span>
                                          </button>
                                        );
                                      })}
                                    </Card>
                                  )}

                                  <button
                                    type="button"
                                    aria-label="Show in folder"
                                    title="Show in folder"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      props.onOpenFile(f.abs_path);
                                    }}
                                    className="w-[26px] h-[26px] rounded-[6px] flex items-center justify-center text-tf-muted hover:text-tf-ink hover:bg-tf-surface-2 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tf-ink"
                                  >
                                    <SquareArrowOutUpRight size={14} strokeWidth={1.75} />
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </Card>
              );
            })}
          </div>

          {/* Empty Folders Line */}
          {emptyFolders.length > 0 && (
            <div className="text-[12.5px] text-tf-faint pt-1">
              Empty folders: {emptyFolders.map(prettyFolderName).join(", ")}
            </div>
          )}
        </section>

        {/* Options Card */}
        <div className="mt-8 space-y-3">
          <SectionTitle>Options</SectionTitle>
          <Card className="divide-y divide-tf-border overflow-hidden">
            {/* Row 1: Copy vs Move radio buttons */}
            <div
              className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3"
              role="radiogroup"
              aria-label="Organization mode"
            >
              <button
                type="button"
                role="radio"
                aria-checked={!props.moveMode}
                onClick={() => props.setMoveMode(false)}
                className={`rounded-[10px] border p-3.5 text-left transition-colors cursor-pointer ${
                  !props.moveMode
                    ? "border-tf-ink/70 ring-1 ring-tf-ink/70 bg-tf-surface"
                    : "border-tf-border hover:border-tf-border-strong bg-tf-surface"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-4 h-4 rounded-full bg-tf-surface shrink-0 ${
                      !props.moveMode
                        ? "border-[5px] border-tf-primary"
                        : "border-[1.5px] border-tf-border-strong"
                    }`}
                  />
                  <span className="text-[13.5px] font-medium text-tf-ink">Copy files</span>
                </div>
                <p className="text-[12.5px] text-tf-muted mt-1 leading-relaxed pl-[26px]">
                  Originals stay where they are. Safest.
                </p>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={props.moveMode}
                onClick={() => props.setMoveMode(true)}
                className={`rounded-[10px] border p-3.5 text-left transition-colors cursor-pointer ${
                  props.moveMode
                    ? "border-tf-ink/70 ring-1 ring-tf-ink/70 bg-tf-surface"
                    : "border-tf-border hover:border-tf-border-strong bg-tf-surface"
                }`}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={`w-4 h-4 rounded-full bg-tf-surface shrink-0 ${
                      props.moveMode
                        ? "border-[5px] border-tf-primary"
                        : "border-[1.5px] border-tf-border-strong"
                    }`}
                  />
                  <span className="text-[13.5px] font-medium text-tf-ink">Move files</span>
                </div>
                <p className="text-[12.5px] text-tf-muted mt-1 leading-relaxed pl-[26px]">
                  Files leave the original folder. Undo is still available.
                </p>
              </button>
            </div>

            {/* Row 2: Clearer file names switch */}
            {props.renameSuggestionCount > 0 && (
              <div className="px-4 py-3.5 flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13.5px] font-medium text-tf-ink">
                    Use clearer file names
                  </div>
                  <div className="text-[12.5px] text-tf-muted mt-0.5 tf-num">
                    {props.renameSuggestionCount}{" "}
                    {props.renameSuggestionCount === 1 ? "suggestion" : "suggestions"} from
                    the file contents
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={props.renamesEnabled}
                  aria-label="Use clearer file names"
                  onClick={() => props.onToggleRenames(!props.renamesEnabled)}
                  className={`w-8 h-[18px] rounded-full relative transition-colors duration-150 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tf-ink shrink-0 ${
                    props.renamesEnabled ? "bg-tf-primary" : "bg-tf-surface-3"
                  }`}
                >
                  <span
                    className={`w-[14px] h-[14px] rounded-full shadow-xs absolute top-[2px] transition-all duration-150 ease-out ${
                      props.renamesEnabled
                        ? "left-[16px] bg-tf-on-primary"
                        : "left-[2px] bg-white dark:bg-tf-faint"
                    }`}
                  />
                </button>
              </div>
            )}

            {/* Row 3: Destination output folder */}
            <div className="px-4 py-3 text-[12.5px] text-tf-muted flex items-center gap-1.5 min-w-0">
              <span className="shrink-0">Saving to</span>
              <span className="font-medium text-tf-ink-2 shrink-0">
                {folderLabel(props.outputFolder)}
              </span>
              <span
                className="font-mono text-[12px] text-tf-faint truncate"
                title={props.outputFolder}
              >
                {props.outputFolder}
              </span>
            </div>
          </Card>
        </div>
      </div>

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

          <div className="flex items-center gap-2.5">
            {props.advancedMode && (
              <Button
                variant="ghost"
                size="sm"
                icon={<Table2 size={15} strokeWidth={1.75} />}
                onClick={props.onOpenAdvancedReview}
              >
                Detailed table
              </Button>
            )}
            <Button
              variant="primary"
              size="md"
              icon={
                props.isApplying ? (
                  <Loader2 size={15} strokeWidth={2} className="animate-spin" />
                ) : (
                  <FolderCheck size={15} strokeWidth={1.75} />
                )
              }
              onClick={props.onApply}
              disabled={includedCount === 0 || props.isApplying || props.isStale}
            >
              {props.isApplying
                ? "Organizing…"
                : `Organize ${includedCount} ${includedCount === 1 ? "file" : "files"}`}
            </Button>
          </div>
        </Card>
      </div>
    </Screen>
  );
}
