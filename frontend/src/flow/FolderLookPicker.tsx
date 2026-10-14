import { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { motion, AnimatePresence } from "motion/react";
import { Ban, Check } from "lucide-react";
import { ease } from "./ui";
import {
  FOLDER_COLORS,
  FOLDER_SYMBOLS,
  folderShade,
  prettyFolderName,
  symbolIcon,
  symbolLabel,
  type FolderColor,
  type FolderLook,
} from "../utils/folderVisuals";

/** Folder name -> how it looks in Finder. Null when folder looks are off or unsupported. */
export const FolderLooksContext = createContext<Record<string, FolderLook> | null>(null);

const QUICK_EMOJI = ["📸", "🧾", "🎓", "💼", "📚", "🎵", "🎬", "✈️", "🏠", "💻", "📦", "⭐️", "❤️", "🧪", "🗂️", "🔒"];

/** A macOS Tahoe folder, drawn the way Finder will show it. */
export function FinderFolder({ look, size = 64 }: { look: FolderLook; size?: number }) {
  const shade = folderShade(look.color);
  const Icon = symbolIcon(look.symbol);
  const id = `ff-${look.color ?? "std"}`;
  return (
    <svg width={size} height={size * 0.8} viewBox="0 0 100 80" aria-hidden className="shrink-0 drop-shadow-[0_1px_1.5px_rgba(0,0,0,0.18)]">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={shade.top} />
          <stop offset="1" stopColor={shade.front} />
        </linearGradient>
      </defs>
      <path d="M6 18a7 7 0 0 1 7-7h19.6a7 7 0 0 1 4.9 2l3.6 3.5H87a7 7 0 0 1 7 7V30H6z" fill={shade.back} />
      <rect x="6" y="22" width="88" height="53" rx="8" fill={`url(#${id})`} />
      <rect x="6.5" y="22.5" width="87" height="2" rx="1" fill="#fff" opacity="0.28" />
      {look.emoji ? (
        <text x="50" y="50.5" textAnchor="middle" dominantBaseline="central" fontSize="30">
          {look.emoji}
        </text>
      ) : Icon ? (
        <Icon x={33} y={31.5} width={34} height={34} color={shade.glyph} strokeWidth={1.9} opacity={0.8} />
      ) : null}
    </svg>
  );
}

interface FolderLookPickerProps {
  open: boolean;
  anchor: HTMLElement | null;
  folderName: string;
  look: FolderLook;
  onChange: (patch: { symbol?: string; emoji?: string | null; color?: FolderColor | null }) => void;
  onReset: () => void;
  onClose: () => void;
}

const WIDTH = 324;

/** Popover for choosing a folder's symbol or emoji and its colour in Finder. */
export function FolderLookPicker({ open, anchor, folderName, look, onChange, onReset, onClose }: FolderLookPickerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const [tab, setTab] = useState<"symbol" | "emoji">(look.emoji ? "emoji" : "symbol");
  const [emojiText, setEmojiText] = useState(look.emoji ?? "");

  useEffect(() => {
    if (!open) return;
    setTab(look.emoji ? "emoji" : "symbol");
    setEmojiText(look.emoji ?? "");
    // Only when opening; edits while open keep the current tab.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const place = useCallback(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const height = panelRef.current?.offsetHeight ?? 440;
    const margin = 12;
    const below = window.innerHeight - r.bottom - margin;
    const above = below < height + 8 && r.top > below;
    const left = Math.min(Math.max(margin, r.left - 6), window.innerWidth - WIDTH - margin);
    const top = above ? Math.max(margin, r.top - height - 8) : r.bottom + 8;
    setPos({ top, left, above });
  }, [anchor]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    const raf = requestAnimationFrame(place); // again once the panel has its real height
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !anchor?.contains(t)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onDown, true);
    const focusTimer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>("[data-selected='true']")?.focus();
    }, 30);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onDown, true);
      window.clearTimeout(focusTimer);
    };
  }, [open, onClose, anchor]);

  const setEmoji = (value: string) => {
    // Keep the first character cluster or two (an emoji or a couple of letters, as Finder allows).
    const text = value.trim();
    const Segmenter = (Intl as unknown as { Segmenter?: new (l?: string, o?: object) => { segment(t: string): Iterable<{ segment: string }> } }).Segmenter;
    const clusters = Segmenter ? Array.from(new Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment) : Array.from(text);
    const short = clusters.slice(0, 2).join("");
    setEmojiText(short);
    onChange({ emoji: short || null });
  };

  const colorName = FOLDER_COLORS.find((c) => c.id === look.color)?.label;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          ref={panelRef}
          role="dialog"
          aria-label={`How ${prettyFolderName(folderName)} looks in Finder`}
          initial={{ opacity: 0, scale: 0.97, y: pos?.above ? 4 : -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }}
          transition={{ duration: 0.16, ease }}
          style={{
            position: "fixed",
            top: pos?.top ?? -9999,
            left: pos?.left ?? -9999,
            width: WIDTH,
            transformOrigin: pos?.above ? "bottom left" : "top left",
          }}
          className="z-50 rounded-[14px] border border-tf-border-strong bg-tf-surface shadow-[var(--shadow-tf-float)] p-3.5"
        >
          {/* Live preview */}
          <div className="flex items-center gap-3.5 pb-3 border-b border-tf-border">
            <div className="w-[76px] h-[62px] rounded-[10px] bg-tf-surface-2 grid place-items-center">
              <motion.div key={`${look.symbol}-${look.emoji}-${look.color}`} initial={{ scale: 0.92 }} animate={{ scale: 1 }} transition={{ duration: 0.18, ease }}>
                <FinderFolder look={look} size={58} />
              </motion.div>
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-medium text-tf-ink truncate">{prettyFolderName(folderName)}</div>
              <div className="text-[12.5px] text-tf-muted mt-0.5">How it will look in Finder</div>
            </div>
          </div>

          {/* Colour */}
          <div className="pt-3">
            <div className="text-[12px] font-medium text-tf-muted mb-2">Color</div>
            <div className="flex items-center gap-[7px]" role="radiogroup" aria-label="Folder color">
              <button
                type="button"
                role="radio"
                aria-checked={!look.color}
                title="Standard"
                onClick={() => onChange({ color: null })}
                className={`w-[26px] h-[26px] rounded-full grid place-items-center cursor-pointer transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-ink focus-visible:ring-offset-2 focus-visible:ring-offset-tf-surface ${
                  !look.color ? "ring-2 ring-tf-ink ring-offset-2 ring-offset-tf-surface" : ""
                }`}
                style={{ background: "linear-gradient(#7fd0f8, #45a7e3)" }}
              >
                {!look.color && <Check size={13} strokeWidth={3} color="#fff" />}
              </button>
              {FOLDER_COLORS.map((c) => {
                const selected = look.color === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={c.label}
                    title={c.label}
                    onClick={() => onChange({ color: selected ? null : c.id })}
                    className={`w-[26px] h-[26px] rounded-full grid place-items-center cursor-pointer transition-shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-ink focus-visible:ring-offset-2 focus-visible:ring-offset-tf-surface ${
                      selected ? "ring-2 ring-tf-ink ring-offset-2 ring-offset-tf-surface" : ""
                    }`}
                    style={{ background: c.swatch }}
                  >
                    {selected && <Check size={13} strokeWidth={3} color="#fff" />}
                  </button>
                );
              })}
            </div>
            <AnimatePresence initial={false}>
              {colorName && (
                <motion.p
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: "auto" }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.16, ease }}
                  className="overflow-hidden text-[12px] text-tf-muted leading-relaxed"
                >
                  <span className="block pt-2">Finder shows colour with a “{colorName}” tag on the folder.</span>
                </motion.p>
              )}
            </AnimatePresence>
          </div>

          {/* Symbol or emoji */}
          <div className="pt-3.5">
            <div className="inline-flex bg-tf-surface-2 p-0.5 rounded-[9px] border border-tf-border" role="tablist">
              {(["symbol", "emoji"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className={`h-7 px-3 text-[12.5px] font-medium rounded-[7px] transition-colors cursor-pointer ${
                    tab === t ? "bg-tf-surface text-tf-ink shadow-[0_1px_2px_rgba(0,0,0,0.08)]" : "text-tf-muted hover:text-tf-ink"
                  }`}
                >
                  {t === "symbol" ? "Symbol" : "Emoji"}
                </button>
              ))}
            </div>

            {tab === "symbol" ? (
              <div className="mt-2.5 grid grid-cols-8 gap-1" role="radiogroup" aria-label="Folder symbol">
                <SymbolCell
                  label="No symbol"
                  selected={!look.symbol && !look.emoji}
                  onClick={() => onChange({ symbol: "", emoji: null })}
                >
                  <Ban size={15} strokeWidth={1.75} />
                </SymbolCell>
                {FOLDER_SYMBOLS.map(({ id, label, Icon }) => (
                  <SymbolCell key={id} label={label} selected={look.symbol === id && !look.emoji} onClick={() => onChange({ symbol: id, emoji: null })}>
                    <Icon size={16} strokeWidth={1.75} />
                  </SymbolCell>
                ))}
              </div>
            ) : (
              <div className="mt-2.5">
                <input
                  value={emojiText}
                  onChange={(e) => setEmoji(e.target.value)}
                  placeholder="Type or paste an emoji"
                  aria-label="Folder emoji"
                  className="h-9 w-full px-3 text-[15px] bg-tf-surface border border-tf-border-strong rounded-[9px] text-tf-ink placeholder:text-tf-faint placeholder:text-[13px] focus:outline-none focus:border-tf-ink"
                />
                <div className="mt-2 grid grid-cols-8 gap-1" role="radiogroup" aria-label="Suggested emoji">
                  {QUICK_EMOJI.map((e) => (
                    <SymbolCell key={e} label={e} selected={look.emoji === e} onClick={() => setEmoji(e)}>
                      <span className="text-[17px] leading-none">{e}</span>
                    </SymbolCell>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-3 pt-3 border-t border-tf-border flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                onReset();
                setEmojiText("");
                setTab("symbol");
              }}
              className="text-[12.5px] font-medium text-tf-muted hover:text-tf-ink cursor-pointer"
            >
              Use suggested
            </button>
            <span className="text-[12px] text-tf-faint truncate">
              {look.emoji ? "Emoji" : look.symbol ? symbolLabel(look.symbol) : "Plain folder"}
            </span>
            <button
              type="button"
              onClick={() => {
                onClose();
                anchor?.focus();
              }}
              className="h-7 px-3 rounded-[8px] bg-tf-primary text-tf-on-primary text-[12.5px] font-medium cursor-pointer"
            >
              Done
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body
  );
}

function SymbolCell({
  label,
  selected,
  onClick,
  children,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      title={label}
      data-selected={selected ? "true" : undefined}
      onClick={onClick}
      className={`h-[34px] rounded-[8px] grid place-items-center transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-tf-ink ${
        selected ? "bg-tf-primary text-tf-on-primary" : "text-tf-ink-2 hover:bg-tf-surface-2 hover:text-tf-ink"
      }`}
    >
      {children}
    </button>
  );
}
