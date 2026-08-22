import { CategoryItem } from "../types";

export interface PresetPack {
  id: string;
  name: string;
  emoji: string;
  description: string;
  prompt: string;
  categories: Record<string, CategoryItem>;
}

export const DEFAULT_STANDARD_CATEGORIES: Record<string, CategoryItem> = {
  "Finance/Invoices": {
    name: "Finance/Invoices",
    description: "Invoices, bills, and purchase requests from vendors or services",
    keywords: ["invoice", "bill", "billing", "due date", "amount due", "invoice number", "total amount", "payment terms", "vendor", "remit payment"],
    extensions: [".pdf", ".png", ".jpg", ".docx"],
    active: true,
  },
  "Finance/Receipts": {
    name: "Finance/Receipts",
    description: "Receipts, proof of purchase, order confirmations, and payment acknowledgments",
    keywords: ["receipt", "order confirmation", "payment received", "transaction id", "subtotal", "merchant", "store", "checkout", "paid", "cash", "visa", "mastercard"],
    extensions: [".pdf", ".png", ".jpg", ".jpeg", ".webp"],
    active: true,
  },
  "Finance/Tax": {
    name: "Finance/Tax",
    description: "Tax returns, W2, 1099, tax deductions, and government revenue filings",
    keywords: ["tax", "w-2", "1099", "irs", "tax return", "deduction", "revenue service", "form 1040", "fiscal year"],
    extensions: [".pdf", ".xlsx", ".csv"],
    active: true,
  },
  "Finance/Statements": {
    name: "Finance/Statements",
    description: "Bank statements, credit card statements, and investment summaries",
    keywords: ["statement", "account summary", "ending balance", "beginning balance", "deposits", "withdrawals", "checking account", "savings account"],
    extensions: [".pdf", ".csv", ".xlsx"],
    active: true,
  },
  "Legal/Contracts": {
    name: "Legal/Contracts",
    description: "Legal agreements, NDA, master service agreements, and terms of service",
    keywords: ["agreement", "contract", "non-disclosure", "nda", "terms and conditions", "hereby agree", "signature", "governing law", "confidentiality"],
    extensions: [".pdf", ".docx", ".doc"],
    active: true,
  },
  "Legal/IDs_and_Certificates": {
    name: "Legal/IDs_and_Certificates",
    description: "Passports, identity cards, driving licenses, certificates, and diplomas",
    keywords: ["passport", "identity card", "driving license", "drivers license", "certificate of", "identification", "date of birth", "nationality", "valid until"],
    extensions: [".pdf", ".png", ".jpg", ".jpeg"],
    active: true,
  },
  "Work/Documents": {
    name: "Work/Documents",
    description: "Work reports, research documents, meeting notes, memos, and proposals",
    keywords: ["report", "meeting notes", "executive summary", "project plan", "roadmap", "proposal", "memorandum", "agenda"],
    extensions: [".pdf", ".docx", ".doc", ".md", ".txt"],
    active: true,
  },
  "Work/Resumes_and_CVs": {
    name: "Work/Resumes_and_CVs",
    description: "Curriculum Vitae, resumes, portfolio documents, and job applications",
    keywords: ["resume", "curriculum vitae", "cv", "work experience", "education", "skills", "employment history", "professional summary"],
    extensions: [".pdf", ".docx", ".doc"],
    active: true,
  },
  "Work/Spreadsheets": {
    name: "Work/Spreadsheets",
    description: "Financial models, data sheets, tables, and tracking sheets",
    keywords: ["spreadsheet", "workbook", "budget", "forecast", "tracking", "inventory", "calculation", "metrics"],
    extensions: [".xlsx", ".xls", ".csv", ".tsv"],
    active: true,
  },
  "Work/Presentations": {
    name: "Work/Presentations",
    description: "Slide decks, pitch decks, and presentations",
    keywords: ["presentation", "slide deck", "keynote", "pitch deck", "overview", "agenda"],
    extensions: [".pptx", ".ppt", ".pdf", ".key"],
    active: true,
  },
  "Personal/Photos": {
    name: "Personal/Photos",
    description: "Personal photography, camera shots, family pictures, and wallpapers",
    keywords: ["photo", "picture", "camera", "portrait", "landscape", "dsc_", "img_"],
    extensions: [".jpg", ".jpeg", ".png", ".heic", ".raw", ".tiff"],
    active: true,
  },
  "Personal/Notes": {
    name: "Personal/Notes",
    description: "Personal notes, journals, quick thoughts, and drafts",
    keywords: ["journal", "diary", "personal note", "thoughts", "ideas", "todo", "checklist"],
    extensions: [".txt", ".md"],
    active: true,
  },
  "Development/Code": {
    name: "Development/Code",
    description: "Source code files and scripts",
    keywords: ["import", "function", "class", "def", "const", "let", "var", "package", "namespace", "return"],
    extensions: [".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".rs", ".go", ".cpp", ".c", ".h", ".java", ".kt", ".dart", ".sh", ".rb", ".php"],
    active: true,
  },
  "Development/Data": {
    name: "Development/Data",
    description: "Data files, database exports, and configuration files",
    keywords: ["json", "yaml", "schema", "database", "dump", "export", "dataset"],
    extensions: [".json", ".yaml", ".yml", ".xml", ".sql", ".db", ".sqlite"],
    active: true,
  },
  "Media/Audio": {
    name: "Media/Audio",
    description: "Audio recordings, podcasts, voice memos, and music tracks",
    keywords: ["audio", "podcast", "recording", "soundtrack", "music"],
    extensions: [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"],
    active: true,
  },
  "Media/Video": {
    name: "Media/Video",
    description: "Video recordings, screen captures, movies, and clips",
    keywords: ["video", "movie", "screen recording", "screencast", "clip"],
    extensions: [".mp4", ".mov", ".mkv", ".avi", ".webm"],
    active: true,
  },
  "Archives": {
    name: "Archives",
    description: "Compressed archive files",
    keywords: ["archive", "zip", "backup", "tar", "compressed"],
    extensions: [".zip", ".tar", ".gz", ".tar.gz", ".bz2", ".7z", ".rar"],
    active: true,
  },
  "Large_Files": {
    name: "Large_Files",
    description: "Very large files exceeding 50 MB",
    keywords: [],
    extensions: [],
    active: true,
  },
};

export const PRESET_PACKS: PresetPack[] = [
  {
    id: "standard",
    name: "Full Standard Taxonomy",
    emoji: "🌟",
    description: "Complete 18-category all-purpose organization across Finance, Legal, Work, Personal, Media & Dev.",
    prompt: "Use the complete standard organization structure covering Finance (Invoices, Receipts, Tax, Statements), Legal (Contracts, IDs), Work (Docs, Resumes, Spreadsheets, Presentations), Personal (Photos, Notes), Development (Code, Data), Media (Audio, Video), and Archives.",
    categories: DEFAULT_STANDARD_CATEGORIES,
  },
  {
    id: "developer",
    name: "Developer Workspace",
    emoji: "💻",
    description: "Source code, JSON/YAML/SQL configs & datasets, technical docs, and archives.",
    prompt: "Group my programming files: code and scripts into Development/Source_Code, JSON/YAML/SQL datasets into Development/Data, technical documentation into Development/Docs, and zip archives into Cold_Storage/Archives.",
    categories: {
      "Development/Source_Code": {
        name: "Development/Source_Code",
        description: "Source code files, scripts, and modules",
        keywords: ["import", "function", "class", "def", "const", "export", "package"],
        extensions: [".py", ".js", ".ts", ".jsx", ".tsx", ".html", ".css", ".rs", ".go", ".cpp", ".c", ".java", ".kt", ".dart", ".sh", ".rb", ".php"],
        active: true,
      },
      "Development/Data_and_Configs": {
        name: "Development/Data_and_Configs",
        description: "Database dumps, schema definitions, JSON/YAML datasets, and config files",
        keywords: ["json", "yaml", "schema", "database", "dump", "export", "migration", "config"],
        extensions: [".json", ".yaml", ".yml", ".xml", ".sql", ".db", ".sqlite"],
        active: true,
      },
      "Development/Documentation": {
        name: "Development/Documentation",
        description: "API specs, architecture diagrams, Markdown guides, and technical notes",
        keywords: ["readme", "api", "architecture", "specification", "guide", "documentation"],
        extensions: [".md", ".txt", ".pdf"],
        active: true,
      },
      "Cold_Storage/Archives": {
        name: "Cold_Storage/Archives",
        description: "Compressed source archives, release bundles, and repository backups",
        keywords: ["archive", "backup", "tar", "zip", "dist", "release"],
        extensions: [".zip", ".tar", ".gz", ".tar.gz", ".7z", ".rar", ".bz2"],
        active: true,
      },
    },
  },
  {
    id: "media",
    name: "Creative Media & Photos",
    emoji: "🎨",
    description: "Photography, design vectors/SVGs, screen recordings, and audio tracks.",
    prompt: "Organize media files: photos and RAW images into Media/Photos, graphic design assets and SVGs into Media/Design_Assets, screen recordings into Media/Recordings, and audio files into Media/Audio.",
    categories: {
      "Media/Photos": {
        name: "Media/Photos",
        description: "Photography, high-resolution camera captures, and image shots",
        keywords: ["photo", "picture", "camera", "portrait", "landscape", "dsc_", "img_"],
        extensions: [".jpg", ".jpeg", ".png", ".heic", ".raw", ".tiff"],
        active: true,
      },
      "Media/Design_Assets": {
        name: "Media/Design_Assets",
        description: "Vector graphics, SVG icons, Figma/PSD source files, and illustrations",
        keywords: ["icon", "logo", "vector", "illustration", "asset", "design", "banner"],
        extensions: [".svg", ".ai", ".psd", ".eps", ".fig"],
        active: true,
      },
      "Media/Recordings": {
        name: "Media/Recordings",
        description: "Screen recordings, video captures, demos, and clips",
        keywords: ["screen recording", "screencast", "recording", "video", "capture", "demo"],
        extensions: [".mp4", ".mov", ".mkv", ".webm", ".avi"],
        active: true,
      },
      "Media/Audio": {
        name: "Media/Audio",
        description: "Voice memos, podcasts, music tracks, and sound effects",
        keywords: ["audio", "recording", "podcast", "soundtrack", "voice memo", "music"],
        extensions: [".mp3", ".wav", ".flac", ".m4a", ".aac", ".ogg"],
        active: true,
      },
    },
  },
  {
    id: "downloads",
    name: "Declutter Downloads",
    emoji: "🧹",
    description: "Fast sorting for screenshots, PDFs, software installers (.dmg, .pkg), and archives.",
    prompt: "Clean up my Downloads folder: route screenshots to Temp/Screenshots, PDF documents to Documents/PDFs, software installers (.dmg, .pkg, .zip) to Installers, and keep everything else in Misc.",
    categories: {
      "Downloads/Screenshots": {
        name: "Downloads/Screenshots",
        description: "Desktop and browser screenshots and screen captures",
        keywords: ["screenshot", "screen shot", "snip", "capture", "cleanshot"],
        extensions: [".png", ".jpg", ".webp"],
        active: true,
      },
      "Downloads/Documents": {
        name: "Downloads/Documents",
        description: "Downloaded PDF documents, manuals, and office files",
        keywords: ["document", "manual", "guide", "form", "statement", "whitepaper"],
        extensions: [".pdf", ".docx", ".doc", ".xlsx", ".pptx", ".txt"],
        active: true,
      },
      "Downloads/Installers": {
        name: "Downloads/Installers",
        description: "Software setup packages, disk images, and application installers",
        keywords: ["setup", "install", "installer", "package", "dmg", "app"],
        extensions: [".dmg", ".pkg", ".zip", ".exe", ".msi"],
        active: true,
      },
      "Downloads/Archives": {
        name: "Downloads/Archives",
        description: "Downloaded compressed ZIP, TAR, and 7Z archives",
        keywords: ["archive", "compressed", "download", "zip"],
        extensions: [".zip", ".tar", ".gz", ".7z", ".rar"],
        active: true,
      },
    },
  },
];
