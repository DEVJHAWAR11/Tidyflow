// Prop contracts for the guided flow screens. App.tsx owns all state and API calls;
// screens are presentational and only call these callbacks.
import type { CategoryItem, ClassifiedFile, ComplexityLevel, BackendStatus } from "../types";

export type FlowStep = "home" | "plan" | "sorting" | "preview" | "done";
export type AppView = "flow" | "search" | "settings" | "advanced_plan" | "advanced_review";

export interface TopBarProps {
  view: AppView;
  step: FlowStep;
  /** Furthest step the user may jump back to via the progress indicator */
  reachableSteps: FlowStep[];
  onGoToStep: (step: FlowStep) => void;
  onOpenView: (view: "flow" | "search" | "settings") => void;
  darkMode: boolean;
  toggleDarkMode: () => void;
  backendStatus: BackendStatus;
}

export interface QuickLocation {
  name: string;
  path: string;
}

export interface HomeScreenProps {
  inputFolder: string;
  outputFolder: string;
  quickLocations: QuickLocation[];
  /** Pick a folder by path; App resets state if it changed and moves to the plan step */
  onPickFolder: (path: string) => void;
  /** Open the OS folder dialog (falls back to the in-app browser); result arrives via onPickFolder */
  onBrowse: () => void;
  /** Change where organized folders get created */
  onChangeOutput: () => void;
  /** True when there are fresh results for inputFolder that the user can return to */
  canResume: boolean;
  resumeFileCount: number;
  onResume: () => void;
  hasLlmKey: boolean;
  /** Friendly message when the AI service is failing (e.g. key rejected), else null */
  aiError: string | null;
  onOpenSettings: () => void;
  backendOnline: boolean;
}

export interface PlanScreenProps {
  inputFolder: string;
  /** Folder plan. Only entries with active === true are shown. Key === folder name on disk. */
  categories: Record<string, CategoryItem>;
  complexityLevel: ComplexityLevel;
  /** AI is reading the folder and suggesting folders */
  isGenerating: boolean;
  /** AI is applying a plain-English change request */
  isRefining: boolean;
  /** Friendly error text, or null */
  planError: string | null;
  /** Short message from the AI after a refine, or null */
  assistantNote: string | null;
  hasLlmKey: boolean;
  /** Friendly message when the AI service is failing; folders then come from basic name matching */
  aiError: string | null;
  /** The current folders came from basic name matching (AI was unavailable when they were made) */
  planIsBasic: boolean;
  onOpenSettings: () => void;
  onChangeDetail: (level: ComplexityLevel) => void;
  onRegenerate: () => void;
  onRefine: (message: string) => void;
  onRename: (oldName: string, newName: string) => void;
  onRemove: (name: string) => void;
  onAdd: (name: string) => void;
  /** Start sorting files into the plan */
  onStart: () => void;
  onBack: () => void;
  advancedMode: boolean;
  onOpenAdvancedEditor: () => void;
}

export interface SortingScreenProps {
  inputFolder: string;
  /** Backend stage id: "scan" | "extract" | "classify" | "finalize" | "error" | "Cancelled" | "" */
  stage: string;
  /** Raw progress lines from the backend, newest last (may start with "> ", "✓ ", "✗ ") */
  logs: string[];
  isCancelling: boolean;
  onCancel: () => void;
  /** Set when the run failed; screen should show it with a retry and back option */
  error: string | null;
  onRetry: () => void;
  onBack: () => void;
}

export interface PreviewScreenProps {
  files: ClassifiedFile[];
  /** Active folder names from the plan, in display order */
  folders: string[];
  /** Files that will be organized */
  selectedFileIds: Set<string>;
  onSetIncluded: (fileId: string, included: boolean) => void;
  /** User-chosen folder per file; effective folder = overrides[id] ?? file.category */
  categoryOverrides: Record<string, string>;
  onMoveFile: (fileId: string, folder: string) => void;
  /** Files at/above this confidence (0-1) count as "sure" */
  autoThreshold: number;
  /** Clearer-name suggestions from the AI */
  renameSuggestionCount: number;
  renamesEnabled: boolean;
  onToggleRenames: (enabled: boolean) => void;
  /** false = copy (originals stay), true = move */
  moveMode: boolean;
  setMoveMode: (move: boolean) => void;
  outputFolder: string;
  /** Results were produced for a different folder plan; ask the user to sort again */
  isStale: boolean;
  onResort: () => void;
  /** Friendly message when the AI service failed during sorting, else null */
  aiError: string | null;
  onOpenSettings: () => void;
  isApplying: boolean;
  onApply: () => void;
  onBack: () => void;
  onOpenFile: (absPath: string) => void;
  advancedMode: boolean;
  onOpenAdvancedReview: () => void;
}

export interface DoneResult {
  count: number;
  action: "copied" | "moved" | string;
  outputDir: string;
  folderCount: number;
  /** Files organized per destination folder, largest first */
  folders?: { name: string; count: number }[];
}

export interface DoneScreenProps {
  result: DoneResult;
  onOpenFolder: () => void;
  onUndo: () => void;
  undoState: "idle" | "working" | "done" | "error";
  undoMessage: string | null;
  onTidyAnother: () => void;
}
