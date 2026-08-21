import React, { useState, useEffect, useRef } from "react";
import {
  Folder,
  FolderOpen,
  FolderPlus,
  ChevronRight,
  ArrowUp,
  Search,
  Monitor,
  Home,
  Download,
  FileText,
  Image,
  HardDrive,
  X,
  Check,
  Loader2,
  RefreshCw,
} from "lucide-react";

interface DirectoryItem {
  name: string;
  path: string;
  is_dir: boolean;
}

interface QuickLocation {
  name: string;
  path: string;
  icon: string;
}

interface DirectoryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  title?: string;
  description?: string;
}

export const DirectoryPickerModal: React.FC<DirectoryPickerModalProps> = ({
  isOpen,
  onClose,
  onSelect,
  initialPath = "",
  title = "Select Folder",
  description = "Choose a directory or open your system file dialog.",
}) => {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [directories, setDirectories] = useState<DirectoryItem[]>([]);
  const [quickLocations, setQuickLocations] = useState<QuickLocation[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isNativeLoading, setIsNativeLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isCreatingFolder, setIsCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [pathInput, setPathInput] = useState("");
  const [isEditingPath, setIsEditingPath] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // Load quick locations on mount
  useEffect(() => {
    if (!isOpen) return;

    fetch("http://localhost:8000/fs/quick-locations")
      .then((res) => res.json())
      .then((data) => {
        if (data.locations) {
          setQuickLocations(data.locations);
        }
      })
      .catch((err) => console.error("Error fetching quick locations:", err));
  }, [isOpen]);

  // Load directory contents when currentPath changes
  const loadDirectory = async (targetPath?: string) => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const url = targetPath
        ? `http://localhost:8000/fs/list-directory?path=${encodeURIComponent(targetPath)}`
        : "http://localhost:8000/fs/list-directory";
      const res = await fetch(url);
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to load directory");
      }
      const data = await res.json();
      setCurrentPath(data.current_path);
      setParentPath(data.parent_path);
      setDirectories(data.directories || []);
      setPathInput(data.current_path);
    } catch (err: any) {
      setErrorMsg(err.message || "Failed to read directory");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadDirectory(initialPath || undefined);
    }
  }, [isOpen, initialPath]);

  // Handle native OS browser
  const handleOpenNativePicker = async () => {
    setIsNativeLoading(true);
    try {
      const res = await fetch("http://localhost:8000/fs/browse-native", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: title,
          initial_dir: currentPath || undefined,
        }),
      });
      const data = await res.json();
      if (data.status === "success" && data.path) {
        onSelect(data.path);
        onClose();
      }
    } catch (err) {
      console.error("Native picker error:", err);
    } finally {
      setIsNativeLoading(false);
    }
  };

  // Create new folder in current directory
  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !currentPath) return;
    try {
      const res = await fetch("http://localhost:8000/fs/create-directory", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parent_path: currentPath,
          name: newFolderName.trim(),
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to create folder");
      }
      const data = await res.json();
      setIsCreatingFolder(false);
      setNewFolderName("");
      // Navigate into new folder
      loadDirectory(data.path);
    } catch (err: any) {
      alert(`Error creating folder: ${err.message}`);
    }
  };

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isOpen) return;
      if (e.key === "Escape") {
        if (isCreatingFolder) {
          setIsCreatingFolder(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isCreatingFolder, onClose]);

  if (!isOpen) return null;

  const filteredDirs = directories.filter((d) =>
    d.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Split path for clickable breadcrumbs
  const pathSegments = currentPath
    ? currentPath.split("/").filter((s) => s.length > 0)
    : [];

  const getQuickIcon = (iconName: string) => {
    switch (iconName) {
      case "download":
        return <Download className="w-3.5 h-3.5" />;
      case "desktop":
        return <Monitor className="w-3.5 h-3.5" />;
      case "file-text":
        return <FileText className="w-3.5 h-3.5" />;
      case "image":
        return <Image className="w-3.5 h-3.5" />;
      case "home":
      default:
        return <Home className="w-3.5 h-3.5" />;
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="bg-[#ffffff] dark:bg-[#1e1e1e] w-full max-w-2xl rounded-2xl border border-[#e6e6e6] dark:border-[#333333] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="p-4 px-6 border-b border-[#e6e6e6] dark:border-[#2d2d2d] flex items-center justify-between bg-[#fafafa] dark:bg-[#252525]">
          <div>
            <div className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-[#0075de] dark:text-[#2383e2]" />
              <h2 className="text-[16px] font-semibold text-[#000000] dark:text-[#ffffff]">
                {title}
              </h2>
            </div>
            <p className="text-[12px] text-[#615d59] dark:text-[#9b9a97] mt-0.5">
              {description}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleOpenNativePicker}
              disabled={isNativeLoading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#0075de]/10 hover:bg-[#0075de]/20 dark:bg-[#2383e2]/15 dark:hover:bg-[#2383e2]/25 text-[#0075de] dark:text-[#8bc5f8] rounded-md text-[12px] font-semibold transition cursor-pointer border border-[#0075de]/25"
              title="Open native OS Finder / File Explorer window"
            >
              {isNativeLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <HardDrive className="w-3.5 h-3.5" />
              )}
              <span>System Finder...</span>
            </button>

            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[#615d59] dark:text-[#9b9a97] hover:bg-[#eae8e5] dark:hover:bg-[#333333] transition cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Quick Locations Bar */}
        {quickLocations.length > 0 && (
          <div className="px-6 py-2 border-b border-[#e6e6e6] dark:border-[#2d2d2d] bg-[#fbfbfa] dark:bg-[#222222] flex items-center gap-1.5 overflow-x-auto text-[11px]">
            <span className="text-[#a39e98] mr-1 font-semibold uppercase tracking-wider text-[10px]">
              Bookmarks:
            </span>
            {quickLocations.map((loc) => {
              const isActive = currentPath === loc.path;
              return (
                <button
                  key={loc.path}
                  onClick={() => loadDirectory(loc.path)}
                  className={`flex items-center gap-1 px-2.5 py-1 rounded-md transition cursor-pointer shrink-0 font-medium ${
                    isActive
                      ? "bg-[#0075de] text-white shadow-2xs"
                      : "bg-[#f1f0ee] dark:bg-[#2c2c2c] text-[#31302e] dark:text-[#d4d4d4] hover:bg-[#eae8e5] dark:hover:bg-[#383838]"
                  }`}
                >
                  {getQuickIcon(loc.icon)}
                  <span>{loc.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Navigation & Breadcrumbs Bar */}
        <div className="p-3 px-6 border-b border-[#e6e6e6] dark:border-[#2d2d2d] flex items-center gap-2 bg-[#ffffff] dark:bg-[#1e1e1e]">
          <button
            onClick={() => parentPath && loadDirectory(parentPath)}
            disabled={!parentPath || isLoading}
            className="p-1.5 rounded-md border border-[#e6e6e6] dark:border-[#333333] hover:bg-[#f6f5f4] dark:hover:bg-[#2a2a2a] disabled:opacity-30 disabled:cursor-not-allowed transition cursor-pointer text-[#31302e] dark:text-[#d4d4d4]"
            title="Go to parent directory"
          >
            <ArrowUp className="w-4 h-4" />
          </button>

          {/* Breadcrumb Path Bar */}
          <div className="flex-1 min-w-0 flex items-center bg-[#f6f5f4] dark:bg-[#262626] border border-[#e6e6e6] dark:border-[#333333] rounded-md px-2.5 py-1.5 text-[12px] font-mono overflow-x-auto">
            {isEditingPath ? (
              <input
                ref={inputRef}
                type="text"
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setIsEditingPath(false);
                    loadDirectory(pathInput.trim());
                  } else if (e.key === "Escape") {
                    setIsEditingPath(false);
                    setPathInput(currentPath);
                  }
                }}
                onBlur={() => {
                  setIsEditingPath(false);
                  loadDirectory(pathInput.trim());
                }}
                className="w-full bg-transparent focus:outline-none text-[#000000] dark:text-[#ffffff]"
                autoFocus
              />
            ) : (
              <div
                onClick={() => {
                  setIsEditingPath(true);
                  setTimeout(() => inputRef.current?.select(), 50);
                }}
                className="flex items-center gap-1 cursor-text w-full overflow-x-auto whitespace-nowrap text-[#31302e] dark:text-[#d4d4d4]"
                title="Click to manually edit path"
              >
                <span
                  onClick={(e) => {
                    e.stopPropagation();
                    loadDirectory("/");
                  }}
                  className="hover:underline cursor-pointer text-[#615d59] dark:text-[#9b9a97]"
                >
                  /
                </span>
                {pathSegments.map((segment, idx) => {
                  const segPath = "/" + pathSegments.slice(0, idx + 1).join("/");
                  const isLast = idx === pathSegments.length - 1;
                  return (
                    <React.Fragment key={segPath}>
                      <span
                        onClick={(e) => {
                          e.stopPropagation();
                          loadDirectory(segPath);
                        }}
                        className={`cursor-pointer hover:underline ${
                          isLast
                            ? "font-bold text-[#0075de] dark:text-[#2383e2]"
                            : "text-[#31302e] dark:text-[#d4d4d4]"
                        }`}
                      >
                        {segment}
                      </span>
                      {!isLast && (
                        <ChevronRight className="w-3 h-3 text-[#a39e98] shrink-0" />
                      )}
                    </React.Fragment>
                  );
                })}
              </div>
            )}
          </div>

          <button
            onClick={() => loadDirectory(currentPath)}
            disabled={isLoading}
            className="p-1.5 rounded-md border border-[#e6e6e6] dark:border-[#333333] hover:bg-[#f6f5f4] dark:hover:bg-[#2a2a2a] transition cursor-pointer text-[#31302e] dark:text-[#d4d4d4]"
            title="Refresh directory"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {/* Search & Actions Bar */}
        <div className="p-2.5 px-6 border-b border-[#e6e6e6] dark:border-[#2d2d2d] flex items-center justify-between gap-3 bg-[#fafafa] dark:bg-[#222222]">
          <div className="relative flex-1">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-[#a39e98]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter subfolders..."
              className="w-full bg-[#ffffff] dark:bg-[#1e1e1e] border border-[#e6e6e6] dark:border-[#333333] rounded-md pl-8 pr-3 py-1.5 text-[12px] text-[#000000] dark:text-[#ffffff] focus:outline-none focus:border-[#0075de] dark:focus:border-[#2383e2]"
            />
          </div>

          {isCreatingFolder ? (
            <div className="flex items-center gap-1.5">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreateFolder();
                  if (e.key === "Escape") setIsCreatingFolder(false);
                }}
                placeholder="Folder Name"
                className="bg-[#ffffff] dark:bg-[#1e1e1e] border border-[#0075de] dark:border-[#2383e2] rounded-md px-2.5 py-1 text-[12px] text-[#000000] dark:text-[#ffffff] focus:outline-none w-36"
                autoFocus
              />
              <button
                onClick={handleCreateFolder}
                className="p-1 px-2 bg-[#0075de] text-white rounded text-[11px] font-semibold hover:bg-[#005bab]"
              >
                Create
              </button>
              <button
                onClick={() => setIsCreatingFolder(false)}
                className="p-1 px-2 text-[#615d59] dark:text-[#9b9a97] text-[11px] hover:bg-[#eae8e5]"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setIsCreatingFolder(true)}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#e6e6e6] dark:border-[#333333] bg-[#ffffff] dark:bg-[#1e1e1e] hover:bg-[#f6f5f4] dark:hover:bg-[#282828] text-[12px] font-medium text-[#31302e] dark:text-[#d4d4d4] transition cursor-pointer shrink-0 shadow-2xs"
            >
              <FolderPlus className="w-3.5 h-3.5 text-[#0075de] dark:text-[#2383e2]" />
              <span>New Folder</span>
            </button>
          )}
        </div>

        {/* Directory List Body */}
        <div className="flex-1 overflow-y-auto p-3 px-6 space-y-1 min-h-[240px] max-h-[360px]">
          {isLoading ? (
            <div className="flex flex-col items-center justify-center py-12 text-[#615d59] dark:text-[#9b9a97]">
              <Loader2 className="w-6 h-6 animate-spin text-[#0075de] mb-2" />
              <span className="text-[13px]">Reading folders...</span>
            </div>
          ) : errorMsg ? (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-center my-6">
              <p className="text-[13px] text-red-600 dark:text-red-400 font-medium">
                {errorMsg}
              </p>
              <button
                onClick={() => loadDirectory(parentPath || "/")}
                className="mt-2 text-[12px] underline text-[#0075de] cursor-pointer"
              >
                Go to parent directory
              </button>
            </div>
          ) : filteredDirs.length === 0 ? (
            <div className="text-center py-12 text-[#a39e98] text-[13px]">
              {searchQuery ? "No matching folders found" : "No subfolders in this directory"}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {filteredDirs.map((dir) => (
                <button
                  key={dir.path}
                  onClick={() => loadDirectory(dir.path)}
                  className="flex items-center gap-2.5 p-2 rounded-lg text-left transition cursor-pointer hover:bg-[#f6f5f4] dark:hover:bg-[#282828] border border-transparent hover:border-[#e6e6e6] dark:hover:border-[#333333] group"
                >
                  <Folder className="w-4 h-4 text-[#0075de] dark:text-[#2383e2] shrink-0 group-hover:scale-110 transition-transform" />
                  <span className="text-[13px] text-[#31302e] dark:text-[#d4d4d4] font-medium truncate">
                    {dir.name}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 px-6 border-t border-[#e6e6e6] dark:border-[#2d2d2d] bg-[#fafafa] dark:bg-[#242424] flex items-center justify-between gap-4">
          <div className="min-w-0 flex-1">
            <span className="text-[10px] text-[#a39e98] uppercase font-bold tracking-wider block">
              Selected Target:
            </span>
            <span className="text-[12px] font-mono text-[#000000] dark:text-[#ffffff] truncate block">
              {currentPath || "No directory selected"}
            </span>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-md border border-[#e6e6e6] dark:border-[#383838] bg-[#ffffff] dark:bg-[#2a2a2a] text-[#31302e] dark:text-[#d4d4d4] hover:bg-[#f6f5f4] dark:hover:bg-[#333333] text-[13px] font-medium transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (currentPath) {
                  onSelect(currentPath);
                  onClose();
                }
              }}
              disabled={!currentPath || isLoading}
              className="flex items-center gap-1.5 px-5 py-2 rounded-md bg-[#0075de] hover:bg-[#005bab] dark:bg-[#2383e2] dark:hover:bg-[#1d70c2] text-white text-[13px] font-semibold transition cursor-pointer shadow-sm disabled:opacity-50 disabled:cursor-not-allowed active:scale-98"
            >
              <Check className="w-4 h-4" />
              <span>Select This Folder</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
