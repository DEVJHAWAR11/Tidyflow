import { CategoryItem, CategorySnapshot, ComplexityLevel } from "../types";

const HISTORY_STORAGE_KEY = "tidyflow_category_history";
const MAX_SNAPSHOTS = 30;

export const loadCategorySnapshots = (): CategorySnapshot[] => {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Failed to load category snapshots from localStorage:", err);
    return [];
  }
};

export const saveCategorySnapshot = (
  label: string,
  trigger: CategorySnapshot["trigger"],
  categories: Record<string, CategoryItem>,
  complexityLevel?: ComplexityLevel
): CategorySnapshot[] => {
  const keys = Object.keys(categories).sort();
  if (keys.length === 0) return loadCategorySnapshots();

  const currentSnapshots = loadCategorySnapshots();

  // Deduplicate against the most recent snapshot if it has identical keys and trigger
  if (currentSnapshots.length > 0) {
    const latest = currentSnapshots[0];
    const latestKeys = Object.keys(latest.categories).sort();
    if (
      latestKeys.length === keys.length &&
      latestKeys.every((k, i) => k === keys[i]) &&
      latest.trigger === trigger &&
      latest.complexity_level === complexityLevel &&
      Date.now() - latest.timestamp < 30000 // within 30 seconds
    ) {
      return currentSnapshots;
    }
  }

  const snapshot: CategorySnapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    timestamp: Date.now(),
    label,
    trigger,
    complexity_level: complexityLevel,
    categories: JSON.parse(JSON.stringify(categories)),
    categoryCount: keys.length,
    folderNames: keys,
  };

  const updated = [snapshot, ...currentSnapshots].slice(0, MAX_SNAPSHOTS);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("Failed to save category snapshot:", err);
  }
  return updated;
};

export const deleteCategorySnapshot = (id: string): CategorySnapshot[] => {
  const current = loadCategorySnapshots();
  const updated = current.filter((s) => s.id !== id);
  try {
    localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(updated));
  } catch (err) {
    console.warn("Failed to delete category snapshot:", err);
  }
  return updated;
};

export const clearCategoryHistory = (): CategorySnapshot[] => {
  try {
    localStorage.removeItem(HISTORY_STORAGE_KEY);
  } catch (err) {
    console.warn("Failed to clear category history:", err);
  }
  return [];
};

export const formatSnapshotRelativeTime = (timestamp: number): string => {
  const diffSec = Math.floor((Date.now() - timestamp) / 1000);
  if (diffSec < 10) return "Just now";
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;

  const date = new Date(timestamp);
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
