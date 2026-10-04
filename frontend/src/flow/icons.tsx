// Platform-neutral icon plates for folders and files (DESIGN.md: surface-strong square plate, ink glyph).
import type { LucideIcon } from "lucide-react";
import {
  File,
  FileArchive,
  FileAudio,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileText,
  FileVideo,
  Folder,
  Package,
  Presentation,
  Database,
} from "lucide-react";
import { folderGlyph, fileKind } from "../utils/folderVisuals";

function plateRadius(size: number) {
  return size >= 40 ? 10 : size >= 28 ? 8 : 6;
}

function Plate({
  Icon,
  size,
  className = "",
}: {
  Icon: LucideIcon;
  size: number;
  className?: string;
}) {
  const glyph = Math.max(11, Math.round(size * 0.5));
  return (
    <span
      aria-hidden
      className={`shrink-0 inline-grid place-items-center bg-tf-surface-3 text-tf-ink border border-tf-border-strong/60 ${className}`}
      style={{ width: size, height: size, borderRadius: plateRadius(size) }}
    >
      <Icon size={glyph} strokeWidth={size >= 28 ? 1.75 : 2} />
    </span>
  );
}

/** Folder symbol: the category's own glyph when recognised, otherwise a plain folder. */
export function FolderIcon({
  name,
  size = 32,
  glyph = true,
  className = "",
}: {
  name: string;
  /** Plate size in px (square) */
  size?: number;
  glyph?: boolean;
  className?: string;
}) {
  const Icon = (glyph && folderGlyph(name)) || Folder;
  return <Plate Icon={Icon} size={size} className={className} />;
}

const KIND_ICONS: Record<string, LucideIcon> = {
  PDF: FileText,
  DOC: FileText,
  TXT: FileText,
  XLS: FileSpreadsheet,
  PPT: Presentation,
  IMG: FileImage,
  ZIP: FileArchive,
  APP: Package,
  AUD: FileAudio,
  VID: FileVideo,
  DATA: Database,
  CODE: FileCode,
};

/** File symbol chosen from the file type. */
export function FileIcon({
  extension,
  fileCategory,
  size = 32,
  className = "",
}: {
  extension: string;
  fileCategory?: string;
  /** Plate size in px (square) */
  size?: number;
  className?: string;
}) {
  const Icon = KIND_ICONS[fileKind(extension, fileCategory).label] || File;
  return <Plate Icon={Icon} size={size} className={className} />;
}

/** Thumbnail if the backend produced one, otherwise the file symbol. */
export function FilePreview({
  extension,
  fileCategory,
  thumbnailB64,
  size = 32,
  className = "",
}: {
  extension: string;
  fileCategory?: string;
  thumbnailB64?: string;
  size?: number;
  className?: string;
}) {
  if (thumbnailB64) {
    return (
      <img
        src={`data:image/png;base64,${thumbnailB64}`}
        alt=""
        width={size}
        height={size}
        className={`shrink-0 object-cover border border-tf-border-strong bg-tf-surface-3 ${className}`}
        style={{ width: size, height: size, borderRadius: plateRadius(size) }}
      />
    );
  }
  return <FileIcon extension={extension} fileCategory={fileCategory} size={size} className={className} />;
}
