import {
  AlertTriangle,
  KeyRound,
  ArrowRight,
  ChevronRight,
  ArrowDownToLine,
  Monitor,
  FileText,
  Image,
  House,
  Folder,
  ShieldCheck,
  Undo2,
  HardDrive,
} from "lucide-react";
import { Screen, Card, Button, StepHeader, SectionTitle } from "./ui";
import { FolderIcon } from "./icons";
import { folderLabel } from "../utils/folderVisuals";
import type { HomeScreenProps } from "./contracts";

function getLocationIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.includes("download")) return ArrowDownToLine;
  if (lower.includes("desktop")) return Monitor;
  if (lower.includes("document")) return FileText;
  if (lower.includes("picture") || lower.includes("photo")) return Image;
  if (lower === "home" || lower.includes("user")) return House;
  return Folder;
}

export function HomeScreen({
  inputFolder,
  outputFolder,
  quickLocations,
  onPickFolder,
  onBrowse,
  onChangeOutput,
  canResume,
  resumeFileCount,
  onResume,
  hasLlmKey,
  aiError,
  onOpenSettings,
  backendOnline,
}: HomeScreenProps) {
  const displayLocations = quickLocations.slice(0, 5);

  return (
    <Screen className="max-w-[760px] mx-auto pt-10 pb-16 px-4">
      {/* Page Header */}
      <StepHeader
        align="left"
        title="Tidy up a folder"
        subtitle="Choose a folder. TidyFlow proposes a set of folders, shows where every file would go, and changes nothing until you approve."
      />

      {/* Status Notice (only one, placed under header) */}
      {!backendOnline ? (
        <div className="mt-6 flex items-center gap-3 rounded-[10px] border border-tf-border bg-tf-surface px-4 py-3">
          <AlertTriangle size={18} strokeWidth={1.75} className="text-tf-danger shrink-0" />
          <span className="text-[13.5px] text-tf-ink">
            TidyFlow's engine isn't running. Quit and reopen the app.
          </span>
        </div>
      ) : aiError ? (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-[10px] border border-tf-border bg-tf-surface px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <AlertTriangle size={18} strokeWidth={1.75} className="text-tf-warn shrink-0" />
            <span className="text-[13.5px] text-tf-ink truncate">
              <span className="font-semibold">Smart sorting is unavailable.</span>{" "}
              <span className="text-tf-muted">{aiError}</span>
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={onOpenSettings} className="shrink-0 ml-auto">
            Open Settings
          </Button>
        </div>
      ) : !hasLlmKey ? (
        <div className="mt-6 flex items-center justify-between gap-3 rounded-[10px] border border-tf-border bg-tf-surface px-4 py-3">
          <div className="flex items-center gap-3 min-w-0">
            <KeyRound size={18} strokeWidth={1.75} className="text-tf-muted shrink-0" />
            <span className="text-[13.5px] text-tf-muted truncate">
              Add an AI key to sort files by their contents, not just their names.
            </span>
          </div>
          <Button variant="secondary" size="sm" onClick={onOpenSettings} className="shrink-0 ml-auto">
            Add key
          </Button>
        </div>
      ) : null}

      {/* Main Card */}
      <Card className="mt-6 overflow-hidden">
        {/* Recent folder row */}
        {inputFolder && (
          <div className="px-5 py-4 border-b border-tf-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-4 min-w-0">
              <FolderIcon name="" glyph={false} size={40} />
              <div className="min-w-0">
                <div className="text-[12px] text-tf-faint">Recent</div>
                <div className="text-[14.5px] font-medium text-tf-ink truncate">
                  {folderLabel(inputFolder)}
                </div>
                <div className="font-mono text-[12px] text-tf-faint truncate" title={inputFolder}>
                  {inputFolder}
                </div>
                {canResume && (
                  <div className="text-[12.5px] text-tf-muted tf-num mt-0.5">
                    {resumeFileCount} {resumeFileCount === 1 ? "file" : "files"} sorted, waiting for review
                  </div>
                )}
              </div>
            </div>

            {canResume ? (
              <Button
                variant="primary"
                size="md"
                iconRight={<ArrowRight size={15} strokeWidth={1.75} />}
                onClick={onResume}
                className="shrink-0 w-full sm:w-auto"
              >
                Review
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="md"
                iconRight={<ArrowRight size={15} strokeWidth={1.75} />}
                onClick={() => onPickFolder(inputFolder)}
                className="shrink-0 w-full sm:w-auto"
              >
                Continue
              </Button>
            )}
          </div>
        )}

        {/* Choose area */}
        <div className="p-5">
          <button
            type="button"
            onClick={onBrowse}
            className="w-full rounded-[12px] border border-dashed border-tf-border-strong bg-tf-surface-2/50 hover:bg-tf-surface-2 hover:border-tf-faint transition-colors px-6 py-8 flex items-center gap-5 text-left cursor-pointer group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40"
          >
            <FolderIcon name="" glyph={false} size={40} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-medium text-tf-ink">Choose a folder…</div>
              <div className="text-[13px] text-tf-muted mt-0.5">Opens the folder picker.</div>
            </div>
            <ChevronRight size={18} strokeWidth={1.75} className="text-tf-faint shrink-0" />
          </button>
        </div>

        {/* Common locations */}
        {displayLocations.length > 0 && (
          <div className="px-5 pb-5">
            <SectionTitle>Common locations</SectionTitle>
            <div className="rounded-[10px] border border-tf-border divide-y divide-tf-border overflow-hidden">
              {displayLocations.map((loc) => {
                const Icon = getLocationIcon(loc.name);
                return (
                  <button
                    key={loc.path}
                    type="button"
                    onClick={() => onPickFolder(loc.path)}
                    className="w-full h-11 px-3.5 flex items-center gap-3 hover:bg-tf-surface-2 transition-colors cursor-pointer text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-brand/40"
                  >
                    <Icon size={17} strokeWidth={1.75} className="text-tf-muted shrink-0" />
                    <span className="text-[14px] font-medium text-tf-ink truncate">{loc.name}</span>
                    <span
                      className="font-mono text-[12px] text-tf-faint truncate flex-1 text-right hidden sm:block"
                      title={loc.path}
                    >
                      {loc.path}
                    </span>
                    <ChevronRight size={15} strokeWidth={1.75} className="text-tf-faint shrink-0" />
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="border-t border-tf-border px-5 py-3 bg-tf-surface-2/40 text-[12.5px] text-tf-muted flex items-center justify-between gap-3">
          <span className="truncate">
            Organized files go to{" "}
            <span className="font-medium text-tf-ink-2" title={outputFolder}>
              {outputFolder ? folderLabel(outputFolder) : "a new “Organized” folder inside it"}
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={onChangeOutput} className="shrink-0">
            Change
          </Button>
        </div>
      </Card>

      {/* Facts Row */}
      <div className="mt-5 flex flex-wrap items-center gap-6 text-[12.5px] text-tf-muted">
        <div className="flex items-center gap-2">
          <ShieldCheck size={14} strokeWidth={1.75} className="text-tf-muted shrink-0" />
          <span>Nothing changes without your approval</span>
        </div>
        <div className="flex items-center gap-2">
          <Undo2 size={14} strokeWidth={1.75} className="text-tf-muted shrink-0" />
          <span>Undo any time</span>
        </div>
        <div className="flex items-center gap-2">
          <HardDrive size={14} strokeWidth={1.75} className="text-tf-muted shrink-0" />
          <span>
            {hasLlmKey
              ? "Files stay on your computer — AI sees only names and short excerpts"
              : "Nothing leaves your computer"}
          </span>
        </div>
      </div>
    </Screen>
  );
}
