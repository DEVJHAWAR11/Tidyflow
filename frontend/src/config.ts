// Dynamic API Configuration for TidyFlow
export const API_BASE = (() => {
  if (typeof window === "undefined" || !window.location) {
    return "http://127.0.0.1:8000";
  }

  // If served directly by FastAPI backend on port 8000
  if (window.location.port === "8000") {
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

