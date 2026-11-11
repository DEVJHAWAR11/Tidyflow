// Dynamic API Configuration for TidyFlow
export const API_BASE = (() => {
  if (typeof window === "undefined" || !window.location) {
    return "http://127.0.0.1:8000";
  }

  // The packaged app serves the page from its own backend, on whatever port was free;
  // always talk to that server, never a fixed port that another TidyFlow may hold.
  if (!(import.meta as any).env?.DEV && window.location.protocol.startsWith("http")) {
    return window.location.origin;
  }

  // If custom environment variable is configured
  const envBase = (import.meta as any).env?.VITE_API_BASE;
  if (envBase) {
    return envBase;
  }

  // Default for Vite dev server (ports 1420, 5173, 3000, etc.) and Tauri windows
  return "http://127.0.0.1:8000";
})();


/** The folder currently being organized (App mirrors it into localStorage). */
export const currentFolder = (): string => {
  try {
    return localStorage.getItem("tidyflow_input_folder") || "";
  } catch {
    return "";
  }
};
