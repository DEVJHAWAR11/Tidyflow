// Dynamic API Configuration for TidyFlow
export const API_BASE =
  typeof window !== "undefined" && window.location && window.location.origin && !window.location.origin.includes(":5173")
    ? window.location.origin
    : "http://127.0.0.1:8000";

