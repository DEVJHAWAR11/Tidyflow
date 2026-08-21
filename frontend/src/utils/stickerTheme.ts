export interface StickerStyle {
  bg: string;
  text: string;
  border: string;
  dot: string;
  name: string;
}

export const STICKER_PALETTE: Record<string, StickerStyle> = {
  sky: {
    bg: "bg-[#e8f4fd] dark:bg-[#0c3966]/40",
    text: "text-[#0060b9] dark:text-[#8bc5f8]",
    border: "border-[#62aef0]/40 dark:border-[#62aef0]/30",
    dot: "bg-[#62aef0]",
    name: "Sky",
  },
  purple: {
    bg: "bg-[#f5eefc] dark:bg-[#3b1959]/40",
    text: "text-[#581c87] dark:text-[#d8b4fe]",
    border: "border-[#d6b6f6]/50 dark:border-[#9b51e0]/30",
    dot: "bg-[#9b51e0]",
    name: "Purple",
  },
  pink: {
    bg: "bg-[#fdeef8] dark:bg-[#4d0c36]/40",
    text: "text-[#9d174d] dark:text-[#f472b6]",
    border: "border-[#ff64c8]/40 dark:border-[#ff64c8]/30",
    dot: "bg-[#ff64c8]",
    name: "Pink",
  },
  orange: {
    bg: "bg-[#fef3eb] dark:bg-[#4a1c07]/40",
    text: "text-[#9a3412] dark:text-[#fb923c]",
    border: "border-[#dd5b00]/30 dark:border-[#dd5b00]/30",
    dot: "bg-[#dd5b00]",
    name: "Orange",
  },
  teal: {
    bg: "bg-[#eaf6f6] dark:bg-[#073634]/40",
    text: "text-[#115e59] dark:text-[#5eead4]",
    border: "border-[#2a9d99]/40 dark:border-[#2a9d99]/30",
    dot: "bg-[#2a9d99]",
    name: "Teal",
  },
  green: {
    bg: "bg-[#ecf7ed] dark:bg-[#0c3917]/40",
    text: "text-[#166534] dark:text-[#4ade80]",
    border: "border-[#1aae39]/40 dark:border-[#1aae39]/30",
    dot: "bg-[#1aae39]",
    name: "Green",
  },
  brown: {
    bg: "bg-[#f6f0ea] dark:bg-[#38230b]/40",
    text: "text-[#523410] dark:text-[#fdba74]",
    border: "border-[#523410]/20 dark:border-[#784f1d]/30",
    dot: "bg-[#784f1d]",
    name: "Brown",
  },
  gray: {
    bg: "bg-[#f1f0ee] dark:bg-[#282828]",
    text: "text-[#31302e] dark:text-[#d4d4d4]",
    border: "border-[#e6e6e6] dark:border-[#383838]",
    dot: "bg-[#a39e98]",
    name: "Gray",
  },
};

const PALETTE_KEYS = ["purple", "teal", "orange", "sky", "pink", "green", "brown"] as const;

/**
 * Deterministically get a tag style for any given string (category name, tag, or extension)
 */
export function getStickerStyle(key: string): StickerStyle {
  if (!key) return STICKER_PALETTE.gray;
  
  const lower = key.toLowerCase();
  if (lower.includes("work") || lower.includes("project")) return STICKER_PALETTE.purple;
  if (lower.includes("finance") || lower.includes("invoice") || lower.includes("tax")) return STICKER_PALETTE.green;
  if (lower.includes("dev") || lower.includes("code") || lower.includes("tech")) return STICKER_PALETTE.sky;
  if (lower.includes("design") || lower.includes("creative") || lower.includes("photo")) return STICKER_PALETTE.pink;
  if (lower.includes("study") || lower.includes("doc") || lower.includes("note")) return STICKER_PALETTE.orange;
  if (lower.includes("archive") || lower.includes("backup")) return STICKER_PALETTE.brown;
  if (lower.includes("personal") || lower.includes("health")) return STICKER_PALETTE.teal;

  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash << 5) - hash + key.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % PALETTE_KEYS.length;
  return STICKER_PALETTE[PALETTE_KEYS[index]];
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
