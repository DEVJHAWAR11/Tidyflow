// The two folder icons in the Library: dashed blue = only in TidyFlow, solid grey = a real folder on disk.

const FOLDER_PATH =
  "M2.75 5.75a1.5 1.5 0 0 1 1.5-1.5h3.4l1.7 1.9h6.4a1.5 1.5 0 0 1 1.5 1.5v7.6a1.5 1.5 0 0 1-1.5 1.5H4.25a1.5 1.5 0 0 1-1.5-1.5z";

export function FolderGlyph({ real, size = 18, className = "" }: { real: boolean; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      aria-hidden
      className={`shrink-0 ${real ? "text-tf-faint" : "text-tf-link"} ${className}`}
    >
      <path
        d={FOLDER_PATH}
        fill="currentColor"
        fillOpacity={real ? 0.4 : 0.12}
        stroke="currentColor"
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeDasharray={real ? undefined : "2.4 1.9"}
      />
    </svg>
  );
}

/** What the two icons mean, shown under the folder list. */
export function FolderLegend() {
  return (
    <div className="space-y-1.5 text-[12px] text-tf-muted">
      <div className="flex items-center gap-2">
        <FolderGlyph real={false} size={16} />
        Only in TidyFlow
      </div>
      <div className="flex items-center gap-2">
        <FolderGlyph real size={16} />
        Real folder on disk
      </div>
    </div>
  );
}
