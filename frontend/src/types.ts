export interface CategoryItem {
  name: string;
  description: string;
  keywords: string[];
  extensions: string[];
  active: boolean;
}

export interface ClassifiedFile {
  file_id: string;
  filename: string;
  abs_path: string;
  rel_path: string;
  extension: string;
  file_size_bytes: number;
  file_category: string;
  category: string;
  confidence: number;
  suggested_filename?: string;
  reason?: string;
  action: string;
  source: string;
  thumbnail_b64?: string;
  extracted_text?: string;
  duplicate_group_id?: string;
  near_duplicate_group_id?: string;
  keyword_scores?: Record<string, number>;
}

export interface RunSummary {
  total_scanned: number;
  total_skipped: number;
  text_extracted: number;
  ocr_processed: number;
  ocr_cached: number;
  exact_duplicates: number;
  near_duplicates: number;
  heuristic_classified: number;
  llm_classified: number;
  manual_review: number;
}

export interface ApplyDecisionItem {
  file_id: string;
  approved: boolean;
  override_category?: string;
  target_filename?: string;
}

export interface FtsResultItem {
  id?: number;
  file_id?: string;
  path: string;
  category?: string;
  confidence_score?: number;
  confidence?: number;
  extracted_text?: string;
  snippet?: string;
  thumbnail_b64?: string;
  file_size_bytes?: number;
  extension?: string;
  suggested_filename?: string;
  reason?: string;
  ocr_text?: string;
  summary?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
  categories?: Record<string, CategoryItem>;
  customInstructions?: string;
  isReady?: boolean;
  complexityLevel?: ComplexityLevel;
}

export interface CategorySnapshot {
  id: string;
  timestamp: number;
  label: string;
  trigger: "tier_switch" | "ai_synthesis" | "preset" | "manual_edit" | "ai_edit" | "restore" | "init";
  complexity_level?: ComplexityLevel;
  categories: Record<string, CategoryItem>;
  categoryCount: number;
  folderNames: string[];
}

export type ComplexityLevel = "low" | "medium" | "high";
export type TabType = "welcome" | "select_folder" | "organize" | "categories" | "review" | "search" | "settings";
export type BackendStatus = "running" | "offline" | "checking";
