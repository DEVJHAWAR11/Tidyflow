// Presentation helpers for folders and files: tint, symbol, file-type label, readable names.
import type { LucideIcon } from "lucide-react";
import {
  Archive,
  BarChart3,
  Banknote,
  BookOpen,
  Briefcase,
  Calendar,
  Camera,
  Code2,
  CreditCard,
  Database,
  FileText,
  Film,
  Gamepad2,
  Globe,
  GraduationCap,
  Heart,
  House,
  Images,
  Landmark,
  Lock,
  Mail,
  Monitor,
  Music2,
  Newspaper,
  Package,
  Palette,
  Plane,
  Receipt,
  ShoppingCart,
  Signature,
  Sparkles,
  Star,
  Stethoscope,
  Table2,
  Terminal,
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

/** Finder colours (macOS tag colours), with the folder artwork shades used for previews. */
export type FolderColor = "red" | "orange" | "yellow" | "green" | "blue" | "purple" | "gray";

export interface FolderShade {
  top: string;
  front: string;
  back: string;
  glyph: string;
}

export const FOLDER_COLORS: ({ id: FolderColor; label: string; swatch: string } & FolderShade)[] = [
  { id: "red", label: "Red", swatch: "#f2544b", top: "#ff8178", front: "#f5554b", back: "#de433b", glyph: "#b9322b" },
  { id: "orange", label: "Orange", swatch: "#f8962f", top: "#ffb661", front: "#fb9a35", back: "#e98524", glyph: "#c36a15" },
  { id: "yellow", label: "Yellow", swatch: "#f6c42a", top: "#ffdb5c", front: "#fbc82e", back: "#e8b31d", glyph: "#b98c0b" },
  { id: "green", label: "Green", swatch: "#35c158", top: "#66d983", front: "#3cc35b", back: "#2dac4b", glyph: "#21903b" },
  { id: "blue", label: "Blue", swatch: "#2f7df6", top: "#5d9cff", front: "#2f80f7", back: "#2269e0", glyph: "#1a55bd" },
  { id: "purple", label: "Purple", swatch: "#b941d3", top: "#d474e8", front: "#c444dc", back: "#aa33c3", glyph: "#8c23a3" },
  { id: "gray", label: "Gray", swatch: "#8e8e93", top: "#b9b9be", front: "#9b9ba1", back: "#86868c", glyph: "#6c6c72" },
];

/** Finder's own folder, used when no colour is chosen. */
export const DEFAULT_FOLDER_SHADE: FolderShade = { top: "#7fd0f8", front: "#5cbcf0", back: "#45a7e3", glyph: "#2f8dcc" };

/** SF Symbols TidyFlow can put on a folder (macOS name), with a matching icon for previews in the app. */
export const FOLDER_SYMBOLS: { id: string; label: string; Icon: LucideIcon }[] = [
  { id: "photo.on.rectangle", label: "Photos", Icon: Images },
  { id: "camera", label: "Camera", Icon: Camera },
  { id: "display", label: "Screen", Icon: Monitor },
  { id: "film", label: "Video", Icon: Film },
  { id: "music.note", label: "Music", Icon: Music2 },
  { id: "paintpalette", label: "Design", Icon: Palette },
  { id: "doc.text", label: "Documents", Icon: FileText },
  { id: "book", label: "Books", Icon: BookOpen },
  { id: "newspaper", label: "Articles", Icon: Newspaper },
  { id: "graduationcap", label: "Study", Icon: GraduationCap },
  { id: "briefcase", label: "Work", Icon: Briefcase },
  { id: "person.crop.circle", label: "Personal", Icon: UserRound },
  { id: "receipt", label: "Receipts", Icon: Receipt },
  { id: "creditcard", label: "Payments", Icon: CreditCard },
  { id: "banknote", label: "Money", Icon: Banknote },
  { id: "chart.bar", label: "Charts", Icon: BarChart3 },
  { id: "tablecells", label: "Spreadsheets", Icon: Table2 },
  { id: "cylinder.split.1x2", label: "Data", Icon: Database },
  { id: "chevron.left.forwardslash.chevron.right", label: "Code", Icon: Code2 },
  { id: "terminal", label: "Scripts", Icon: Terminal },
  { id: "shippingbox", label: "Apps", Icon: Package },
  { id: "archivebox", label: "Archives", Icon: Archive },
  { id: "airplane", label: "Travel", Icon: Plane },
  { id: "house", label: "Home", Icon: House },
  { id: "heart", label: "Favorites", Icon: Heart },
  { id: "cross.case", label: "Health", Icon: Stethoscope },
  { id: "building.columns", label: "Legal", Icon: Landmark },
  { id: "signature", label: "Signed", Icon: Signature },
  { id: "envelope", label: "Mail", Icon: Mail },
  { id: "calendar", label: "Dates", Icon: Calendar },
  { id: "cart", label: "Shopping", Icon: ShoppingCart },
  { id: "gamecontroller", label: "Games", Icon: Gamepad2 },
  { id: "globe", label: "Web", Icon: Globe },
  { id: "lock", label: "Private", Icon: Lock },
  { id: "star", label: "Important", Icon: Star },
  { id: "sparkles", label: "Ideas", Icon: Sparkles },
];

const SYMBOL_BY_ID = new Map(FOLDER_SYMBOLS.map((s) => [s.id, s]));

export function symbolIcon(id: string | null | undefined): LucideIcon | null {
  return (id && SYMBOL_BY_ID.get(id)?.Icon) || null;
}

export function symbolLabel(id: string | null | undefined): string {
  return (id && SYMBOL_BY_ID.get(id)?.label) || "";
}

// [pattern, symbol, preferred tone index]: the folder's symbol when nobody picked one.
const GLYPH_RULES: [RegExp, string, number][] = [
  [/photo|media|picture|image|img|wallpaper/i, "photo.on.rectangle", 4],
  [/screen ?shot|screen ?cap/i, "display", 7],
  [/resume|\bcv\b|cover ?letter|job|career/i, "person.crop.circle", 0],
  [/invoice|receipt|bill/i, "receipt", 1],
  [/payment|finance|bank|tax|statement|expense|money/i, "creditcard", 1],
  [/course|class|study|school|academic|lecture|homework|assignment|certificate|learn/i, "graduationcap", 3],
  [/work|project|client|meeting|business|office/i, "briefcase", 0],
  [/install|software|setup|\bdmg\b|\bapps?\b/i, "shippingbox", 7],
  [/archive|zip|compress|backup/i, "archivebox", 3],
  [/spreadsheet|excel|budget|csv/i, "tablecells", 1],
  [/database|sql|data|dataset/i, "cylinder.split.1x2", 5],
  [/code|dev|script|source|program/i, "chevron.left.forwardslash.chevron.right", 5],
  [/music|audio|song|podcast|sound/i, "music.note", 6],
  [/video|movie|film|clip|recording/i, "film", 6],
  [/design|icon|logo|figma|sketch|asset|font/i, "paintpalette", 4],
  [/travel|trip|ticket|flight|booking|hotel/i, "airplane", 5],
  [/health|medical|doctor|insurance/i, "cross.case", 6],
  [/legal|contract|agreement|license/i, "building.columns", 7],
  [/book|ebook|reading|notes?/i, "book", 2],
  [/document|docs?\b|paper|pdf|general|misc/i, "doc.text", 0],
  [/personal|family|home/i, "house", 2],
  [/camera|dcim/i, "camera", 4],
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

/** Symbol suggested for a folder from its name; null for a plain folder. */
export function suggestedSymbol(name: string): string | null {
  return matchRule(name)?.[1] ?? null;
}

/** Symbol pressed into the folder artwork; null for a plain folder. */
export function folderGlyph(name: string): LucideIcon | null {
  return symbolIcon(suggestedSymbol(name));
}

export interface FolderLook {
  symbol: string | null;
  emoji: string | null;
  color: FolderColor | null;
}

/**
 * How a folder will look in Finder. An emoji wins over a symbol; `symbol: ""` means the user chose none,
 * while a missing symbol falls back to one suggested by the folder's name.
 */
export function folderLook(cat: {
  name: string;
  description?: string;
  symbol?: string | null;
  emoji?: string | null;
  color?: FolderColor | null;
}): FolderLook {
  const emoji = cat.emoji?.trim() || null;
  let symbol: string | null = null;
  if (!emoji && cat.symbol !== "") {
    symbol =
      cat.symbol && SYMBOL_BY_ID.has(cat.symbol)
        ? cat.symbol
        : suggestedSymbol(cat.name) ?? (cat.description ? suggestedSymbol(cat.description) : null);
  }
  return { symbol, emoji, color: cat.color ?? null };
}

export function folderShade(color: FolderColor | null): FolderShade {
  return FOLDER_COLORS.find((c) => c.id === color) ?? DEFAULT_FOLDER_SHADE;
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
