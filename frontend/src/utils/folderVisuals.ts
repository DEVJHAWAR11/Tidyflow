// Presentation helpers for folders and files: tint, symbol, file-type label, readable names.
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BookOpen,
  Briefcase,
  Camera,
  Clapperboard,
  Code2,
  Database,
  FileText,
  GraduationCap,
  HeartPulse,
  House,
  Image,
  Monitor,
  Music2,
  Package,
  Palette,
  Plane,
  Receipt,
  Scale,
  Sheet,
  UserRound,
} from "lucide-react";

export interface FolderTone {
  /** Hex colours for the SVG folder artwork */
  front: string;
  frontTop: string;
  back: string;
  glyph: string;
  /** Solid swatch (hex) for dots / bars */
  swatch: string;
}

// Muted, slightly desaturated hues so a grid of folders reads as one calm family.
const TONES: FolderTone[] = [
  { front: "#6f9be8", frontTop: "#88aef0", back: "#5585db", glyph: "#1f4a99", swatch: "#5585db" }, // blue
  { front: "#86b59a", frontTop: "#9cc5ad", back: "#6c9d81", glyph: "#2f5e44", swatch: "#6c9d81" }, // sage
  { front: "#e0997a", frontTop: "#e9ad93", back: "#cf7f5d", glyph: "#8a3d1d", swatch: "#cf7f5d" }, // clay
  { front: "#e3bd62", frontTop: "#ebcb80", back: "#d1a746", glyph: "#7f5a0b", swatch: "#d1a746" }, // ochre
  { front: "#a891d9", frontTop: "#b9a6e2", back: "#8f74c8", glyph: "#4c3290", swatch: "#8f74c8" }, // plum
  { front: "#73b5b7", frontTop: "#8cc4c6", back: "#579ea1", glyph: "#20605f", swatch: "#579ea1" }, // teal
  { front: "#df8fa2", frontTop: "#e8a6b6", back: "#cd7189", glyph: "#8a2c47", swatch: "#cd7189" }, // rose
  { front: "#a4abb5", frontTop: "#b7bdc5", back: "#8b929d", glyph: "#3d444e", swatch: "#8b929d" }, // graphite
];

const GLYPH_RULES: [RegExp, LucideIcon, number][] = [
  // [pattern, icon, preferred tone index]
  [/screen ?shot|screen ?cap/i, Monitor, 7],
  [/photo|picture|image|img|camera|wallpaper/i, Image, 4],
  [/resume|\bcv\b|cover ?letter|job|career/i, UserRound, 0],
  [/invoice|receipt|bill|payment|finance|bank|tax|statement|expense|money/i, Receipt, 1],
  [/course|class|study|school|academic|lecture|homework|assignment|certificate|learn/i, GraduationCap, 3],
  [/work|project|client|meeting|business|office/i, Briefcase, 0],
  [/install|software|setup|\bdmg\b|\bapps?\b/i, Package, 7],
  [/archive|zip|compress|backup/i, Archive, 3],
  [/spreadsheet|excel|budget|csv/i, Sheet, 1],
  [/database|sql|data|dataset/i, Database, 5],
  [/code|dev|script|source|program/i, Code2, 5],
  [/music|audio|song|podcast|sound/i, Music2, 6],
  [/video|movie|film|clip|recording/i, Clapperboard, 6],
  [/design|icon|logo|figma|sketch|asset|font/i, Palette, 4],
  [/travel|trip|ticket|flight|booking|hotel/i, Plane, 5],
  [/health|medical|doctor|insurance/i, HeartPulse, 6],
  [/legal|contract|agreement|license/i, Scale, 7],
  [/book|ebook|reading|notes?/i, BookOpen, 2],
  [/document|docs?\b|paper|pdf|general|misc/i, FileText, 0],
  [/personal|family|home/i, House, 2],
  [/camera|dcim/i, Camera, 4],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function matchRule(name: string) {
  const leaf = name.split("/").pop() || name;
  return GLYPH_RULES.find(([re]) => re.test(leaf)) || GLYPH_RULES.find(([re]) => re.test(name));
}

/** "Finance/Payments" -> "Payments"; "React_Course_Images" -> "React Course Images" */
export function prettyFolderName(name: string): string {
  if (!name) return "";
  if (name === "Unknown") return "Not sure yet";
  const last = name.split("/").filter(Boolean).pop() || name;
  return last.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Parent group of a nested category, e.g. "Finance/Payments" -> "Finance". Empty when flat. */
export function folderGroup(name: string): string {
  const parts = name.split("/").filter(Boolean);
  return parts.length > 1 ? parts.slice(0, -1).join(" / ").replace(/[_-]+/g, " ") : "";
}

/** Symbol pressed into the folder artwork; null for a plain folder. */
export function folderGlyph(name: string): LucideIcon | null {
  return matchRule(name)?.[1] ?? null;
}

/** Stable tint for a folder: themed by its symbol when recognised, else by name. */
export function folderTone(name: string): FolderTone {
  const rule = matchRule(name);
  return TONES[rule ? rule[2] : hash(name) % TONES.length];
}

/** Turn what the user typed into a safe folder name for disk. */
export function toFolderName(input: string): string {
  return input
    .replace(/[\\:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);
}

export interface FileKind {
  label: string;
  color: string;
}

const EXT_KINDS: [string[], FileKind][] = [
  [["pdf"], { label: "PDF", color: "#d0453a" }],
  [["doc", "docx", "rtf", "odt", "pages"], { label: "DOC", color: "#2f6bed" }],
  [["txt", "md", "log"], { label: "TXT", color: "#77777d" }],
  [["xls", "xlsx", "csv", "numbers", "ods"], { label: "XLS", color: "#1d8a55" }],
  [["ppt", "pptx", "key", "odp"], { label: "PPT", color: "#d4782a" }],
  [["jpg", "jpeg", "png", "gif", "webp", "heic", "bmp", "svg", "tiff"], { label: "IMG", color: "#7a5ad8" }],
  [["zip", "rar", "7z", "tar", "gz", "tbz2", "bz2", "xz"], { label: "ZIP", color: "#a8832a" }],
  [["dmg", "pkg", "exe", "msi", "app", "deb"], { label: "APP", color: "#4e555e" }],
  [["mp3", "wav", "m4a", "flac", "aac", "ogg"], { label: "AUD", color: "#c9467f" }],
  [["mp4", "mov", "avi", "mkv", "webm"], { label: "VID", color: "#2a8796" }],
  [["sql", "db", "sqlite", "json", "xml", "yaml", "yml"], { label: "DATA", color: "#56677c" }],
  [["js", "ts", "tsx", "jsx", "py", "java", "c", "cpp", "go", "rs", "html", "css", "sh"], { label: "CODE", color: "#0f766e" }],
];

/** Short type label + colour for the document icon. */
export function fileKind(extension: string, fileCategory?: string): FileKind {
  const ext = (extension || "").toLowerCase().replace(/^\./, "");
  for (const [exts, kind] of EXT_KINDS) if (exts.includes(ext)) return kind;
  if (fileCategory === "image") return { label: "IMG", color: "#7a5ad8" };
  return { label: ext ? ext.slice(0, 4).toUpperCase() : "FILE", color: "#8b8b90" };
}

export function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n < 10 && i > 0 ? n.toFixed(1) : Math.round(n)} ${units[i]}`;
}

/** Last path segment, for showing "Downloads" instead of "/Users/x/Downloads". */
export function folderLabel(path: string): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] || path;
}
