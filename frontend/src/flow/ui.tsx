// Shared building blocks for the TidyFlow UI. Use these instead of ad-hoc styles.
import React from "react";
import { motion, type HTMLMotionProps } from "motion/react";
import { FolderIcon } from "./icons";

export const ease = [0.2, 0, 0, 1] as const;

/** Page-level wrapper: a short, quiet fade between screens (used inside AnimatePresence). */
export function Screen({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.22, ease }}
      className={`w-full ${className}`}
    >
      {children}
    </motion.div>
  );
}

/** Stagger container + item for lists of cards. */
export const staggerParent = {
  hidden: {},
  show: { transition: { staggerChildren: 0.025, delayChildren: 0.02 } },
};
export const staggerChild = {
  hidden: { opacity: 0, y: 6 },
  show: { opacity: 1, y: 0, transition: { duration: 0.24, ease } },
};

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "accent";
type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-tf-primary hover:bg-tf-primary-hover text-tf-on-primary shadow-[var(--shadow-tf-brand)]",
  accent: "bg-tf-primary hover:bg-tf-primary-hover text-tf-on-primary",
  secondary: "bg-tf-surface hover:bg-tf-surface-2 text-tf-ink border border-tf-border-strong",
  ghost: "bg-transparent hover:bg-tf-surface-2 text-tf-ink-2 hover:text-tf-ink",
  danger: "bg-transparent hover:bg-tf-danger-soft text-tf-danger border border-tf-border-strong",
};
// DESIGN.md button: 14px / 500, 8px radius, 40px tall at full size.
const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[6px]",
  md: "h-9 px-4 text-[14px] gap-2 rounded-[var(--radius-tf-btn)]",
  lg: "h-10 px-[18px] text-[14px] gap-2 rounded-[var(--radius-tf-btn)]",
};

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: React.ReactNode;
  iconRight?: React.ReactNode;
  children?: React.ReactNode;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconRight,
  children,
  className = "",
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.985 }}
      disabled={disabled}
      className={`inline-flex items-center justify-center font-medium whitespace-nowrap select-none transition-colors duration-150 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-ink focus-visible:ring-offset-2 focus-visible:ring-offset-tf-bg ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {icon}
      {children}
      {iconRight}
    </motion.button>
  );
}

export function Card({
  children,
  className = "",
  ...rest
}: React.HTMLAttributes<HTMLDivElement> & { children: React.ReactNode }) {
  return (
    <div
      className={`bg-tf-surface border border-tf-border-strong rounded-[var(--radius-tf-card)] ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

/** Folder artwork for a category. `size` is the icon width in px. */
export function FolderBadge({ name, size = 32 }: { name: string; size?: number }) {
  return <FolderIcon name={name} size={size} />;
}

export function Pill({
  children,
  tone = "neutral",
  className = "",
}: {
  children: React.ReactNode;
  tone?: "neutral" | "brand" | "success" | "warn" | "danger";
  className?: string;
}) {
  const tones = {
    neutral: "bg-tf-surface-3 text-tf-ink border-transparent",
    brand: "bg-tf-surface-3 text-tf-ink border-transparent",
    success: "bg-tf-success-soft text-tf-success border-transparent",
    warn: "bg-tf-warn-soft text-tf-warn border-transparent",
    danger: "bg-tf-danger-soft text-tf-danger border-transparent",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 h-[22px] px-2.5 rounded-full border text-[11px] font-semibold uppercase tracking-[0.08em] tf-num ${tones[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

/** Small status dot, e.g. before a Pill label. */
export function Dot({ className = "" }: { className?: string }) {
  return <span className={`inline-block w-1.5 h-1.5 rounded-full bg-current ${className}`} />;
}

/** Page heading block used at the top of each step. */
export function StepHeader({
  eyebrow,
  title,
  subtitle,
  align = "left",
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  align?: "left" | "center";
}) {
  return (
    <div className={align === "center" ? "text-center mx-auto max-w-xl" : "max-w-2xl"}>
      {eyebrow && (
        <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-tf-faint mb-3 tf-num">{eyebrow}</div>
      )}
      {/* DESIGN.md display-md: 28px / 600 / -0.84px */}
      <h1 className="text-[28px] leading-[1.2] font-semibold tracking-[-0.84px] text-tf-ink">{title}</h1>
      {subtitle && <p className="mt-2 text-[16px] leading-[1.5] text-tf-muted">{subtitle}</p>}
    </div>
  );
}

/** Section label inside a screen. */
export function SectionTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <h2 className="text-[16px] leading-[1.4] font-semibold text-tf-ink">{children}</h2>
      {aside}
    </div>
  );
}

/** Calm placeholder block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-tf-surface-2 rounded-lg animate-pulse ${className}`} />;
}
