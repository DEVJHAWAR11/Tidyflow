// Typed calls for the Library: TidyFlow folders and the files in them.
import { API_BASE } from "../../config";

export interface LibraryFolder {
  id: number;
  name: string;
  parent_id: number | null;
  /** Set when this is a real folder: every file in it sits in this folder on disk. */
  disk_path: string | null;
  /** disk_path with the home folder shown as "~". */
  disk_label: string | null;
  is_real: boolean;
  /** Files directly in this folder (not in its subfolders). */
  count: number;
}

export interface LibraryFolders {
  folders: LibraryFolder[];
  /** Files TidyFlow knows about that are in no folder yet. */
  unsorted_count: number;
  total_files: number;
}

export interface LibraryFile {
  id: number;
  name: string;
  /** Where the file was found when it was scanned. */
  path: string;
  /** Where it is now (its organized copy or place, else where it was found); null when it can't be found. */
  current_path: string | null;
  /** The folder it really lives in, with the home folder shown as "~". */
  lives_in: string;
  missing: boolean;
  extension: string;
  file_size_bytes: number;
  summary: string;
  thumbnail_b64: string | null;
  added_at: string | null;
}

export interface LibraryFilePage {
  folder: LibraryFolder | null;
  total: number;
  files: LibraryFile[];
}

/** A folder id, or "unsorted" for the files in no folder. */
export type FolderKey = number | "unsorted";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || "TidyFlow couldn't load your Library.");
  return data as T;
}

export const fetchFolders = () => getJson<LibraryFolders>("/library/folders");

export const fetchFolderFiles = (key: FolderKey, offset = 0, limit = 50) =>
  getJson<LibraryFilePage>(`/library/folders/${key}/files?offset=${offset}&limit=${limit}`);

// --- Actions ---

async function send<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(typeof data.detail === "string" ? data.detail : "That didn't work. Try again.");
  return data as T;
}

export interface PasteResult {
  /** The target is a real folder and some files aren't in it on disk: nothing changed yet. */
  needs_disk_move: boolean;
  dest_dir?: string;
  count: number;
}

export interface LibraryAction {
  id: number;
  kind: string;
  label: string;
  at: string;
}

export const libraryActions = {
  newFolder: (name: string, parentId: number | null) =>
    send<LibraryFolder>("POST", "/library/folders", { name, parent_id: parentId }),
  renameFolder: (id: number, name: string) => send<LibraryFolder>("PATCH", `/library/folders/${id}`, { name }),
  deleteFolder: (id: number) =>
    send<{ deleted_folders: number; files_unsorted: number }>("DELETE", `/library/folders/${id}`),
  makeReal: (id: number, parentDir: string) =>
    send<{ moved: number; disk_path: string }>("POST", `/library/folders/${id}/make-real`, { parent_dir: parentDir }),
  paste: (fileIds: number[], toFolderId: number, op: "cut" | "copy", fromFolderId: number | null) =>
    send<PasteResult>("POST", "/library/paste", {
      file_ids: fileIds,
      to_folder_id: toFolderId,
      op,
      from_folder_id: fromFolderId,
    }),
  remove: (fileIds: number[], folderId: number) =>
    send<{ count: number }>("POST", "/library/remove", { file_ids: fileIds, folder_id: folderId }),
  renameFile: (fileId: number, newName: string) =>
    send<{ path: string }>("POST", "/library/rename-file", { file_id: fileId, new_name: newName }),
  moveOnDisk: (
    fileIds: number[],
    destDir: string,
    opts: { toFolderId?: number | null; fromFolderId?: number | null; op?: "cut" | "copy" } = {},
  ) =>
    send<{ moved: number; dest_dir: string; unreal_folders: number[] }>("POST", "/library/move-on-disk", {
      file_ids: fileIds,
      dest_dir: destDir,
      to_folder_id: opts.toFolderId ?? null,
      from_folder_id: opts.fromFolderId ?? null,
      op: opts.op ?? "cut",
    }),
  trash: (fileIds: number[]) =>
    send<{ trashed: number; forgotten: number }>("POST", "/library/trash", { file_ids: fileIds }),
  history: () => send<{ actions: LibraryAction[] }>("GET", "/library/history"),
  undo: () => send<{ undone: string; kind: string }>("POST", "/library/undo"),
};

/**
 * Ask for a folder on disk with the system's own picker.
 * Resolves to the path, null when cancelled, or throws when there is no system picker.
 */
export async function browseForFolder(prompt: string, initialDir?: string | null): Promise<string | null> {
  const res = await fetch(`${API_BASE}/fs/browse-native`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, initial_dir: initialDir || undefined }),
  });
  if (!res.ok) throw new Error("No system folder picker");
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data.path && !data.cancelled ? data.path : null;
}

// --- New since last time ---

export interface ScanRoot {
  path: string;
  /** The path as people say it, home shown as "~". */
  label: string;
  /** When it was checked before the check these results came from (UTC, "YYYY-MM-DD HH:MM:SS"), or null. */
  last_checked_at: string | null;
  exists: boolean;
}

export interface NewFile {
  path: string;
  name: string;
  size: number;
  modified: number;
  root: string;
  lives_in: string;
}

export interface NewCheck {
  roots: ScanRoot[];
  new: NewFile[];
  total_new: number;
  /** Files renamed or moved inside the scanned folders that were followed. */
  followed: number;
  /** Files TidyFlow can't find any more. */
  missing: number;
  checked_at: string;
}

export interface SuggestedFile {
  id: number;
  name: string;
  path: string;
  lives_in: string;
  extension: string;
  file_size_bytes: number;
  /** A folder path like "Finance/Bills", or null when TidyFlow couldn't tell. */
  suggestion: string | null;
  confidence: number | null;
  reason: string;
  thumbnail_b64: string | null;
}

export interface Suggestions {
  status: "success" | "cancelled";
  files: SuggestedFile[];
  /** Every folder path the files could go in. */
  folders: string[];
  used_ai: boolean;
}

export const newFiles = {
  /** The last check (the backend checks first if it hasn't since the app opened). */
  status: () => send<NewCheck>("GET", "/library/new"),
  check: () => send<NewCheck>("POST", "/library/check-new"),
  suggest: (paths: string[]) => send<Suggestions>("POST", "/library/new/suggest", { paths }),
  cancel: () => send<unknown>("POST", "/pipeline/cancel"),
  sort: (items: { id: number; folder: string | null; suggested?: string | null }[]) =>
    send<{ sorted: number }>("POST", "/library/new/sort", { items }),
};

/** "earlier today", "yesterday", "Monday", or a date: when a folder was last checked. */
export function sinceLabel(sqliteUtc: string | null): string | null {
  if (!sqliteUtc) return null;
  const then = new Date(sqliteUtc.replace(" ", "T") + (sqliteUtc.endsWith("Z") ? "" : "Z"));
  if (Number.isNaN(then.getTime())) return null;
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(new Date()) - startOfDay(then)) / 86_400_000);
  if (days <= 0) return "earlier today";
  if (days === 1) return "yesterday";
  if (days < 7) return then.toLocaleDateString(undefined, { weekday: "long" });
  return then.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// --- Rules it learned, and Library settings ---

export interface LearnedRule {
  id: number;
  folder_id: number;
  /** The folder's path, like "Finance/Bills". */
  folder: string;
  /** The word looked for in file names. */
  contains: string;
  created_at: string;
}

export interface RuleSuggestion {
  folder_id: number;
  folder: string;
  contains: string;
  /** Files you put in this folder yourself that have the word. */
  corrections: number;
  /** Files in the folder now that have the word. */
  matching: number;
  examples: string[];
}

export interface LibrarySettings {
  finder_tags: boolean;
  finder_tags_supported: boolean;
}

export const learnedRules = {
  list: () => send<{ rules: LearnedRule[]; suggestions: RuleSuggestion[] }>("GET", "/library/rules"),
  add: (folder_id: number, contains: string) => send<LearnedRule>("POST", "/library/rules", { folder_id, contains }),
  remove: (id: number) => send<{ removed: number }>("DELETE", `/library/rules/${id}`),
  dismiss: (folder_id: number, contains: string) =>
    send<{ dismissed: boolean }>("POST", "/library/rules/dismiss", { folder_id, contains }),
};

export const librarySettings = {
  get: () => send<LibrarySettings>("GET", "/library/settings"),
  setFinderTags: (on: boolean) =>
    send<LibrarySettings & { tagged: number; untagged: number; failed: number }>("POST", "/library/settings", {
      finder_tags: on,
    }),
};
