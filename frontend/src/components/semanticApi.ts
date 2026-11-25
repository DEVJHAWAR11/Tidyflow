// Search by meaning: the backend's /semantic routes and its "semantic" status events.
import { useCallback, useEffect, useState } from "react";
import { API_BASE } from "../config";

export type SemanticPhase = "off" | "needs_download" | "downloading" | "indexing" | "ready" | "error";

export interface SemanticModel {
  key: string;
  label: string;
  filename: string;
  size_bytes: number;
  blurb: string;
  recommended: boolean;
  downloaded: boolean;
}

export interface SemanticStatus {
  enabled: boolean;
  model: string;
  phase: SemanticPhase;
  error: string | null;
  engine_available: boolean;
  engine_running: boolean;
  download: { done: number; total: number };
  index: { done: number; total: number; vectors: number };
  models: SemanticModel[];
}

async function call(path: string, init?: RequestInit): Promise<SemanticStatus> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json" } : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

export const semanticApi = {
  status: () => call("/semantic/status"),
  enable: (model: string) => call("/semantic/enable", { method: "POST", body: JSON.stringify({ model }) }),
  disable: () => call("/semantic/disable", { method: "POST" }),
  cancel: () => call("/semantic/cancel", { method: "POST" }),
  retry: () => call("/semantic/retry", { method: "POST" }),
  remove: () => call("/semantic", { method: "DELETE" }) as Promise<SemanticStatus & { freed_bytes: number }>,
  warm: () => fetch(`${API_BASE}/semantic/warm`, { method: "POST" }).catch(() => undefined),
};

/** The current status, kept live from the server's events while the component is shown. */
export function useSemanticStatus() {
  const [status, setStatus] = useState<SemanticStatus | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  const refresh = useCallback(() => {
    semanticApi
      .status()
      .then((s) => {
        setStatus(s);
        setLoadFailed(false);
      })
      .catch(() => setLoadFailed(true));
  }, []);

  useEffect(() => {
    refresh();
    let es: EventSource | null = null;
    try {
      es = new EventSource(`${API_BASE}/events`);
      es.addEventListener("semantic", (e) => {
        try {
          setStatus(JSON.parse((e as MessageEvent).data));
        } catch {
          // A bad event is skipped; the next one carries the whole status again.
        }
      });
      // Events missed while disconnected: read the status again once reconnected.
      es.addEventListener("open", refresh);
    } catch {
      // Without events the status still loads; it just doesn't move on its own.
    }
    return () => es?.close();
  }, [refresh]);

  return { status, setStatus, refresh, loadFailed };
}

export function formatMB(bytes: number): string {
  return `${Math.round(bytes / 1_000_000).toLocaleString()} MB`;
}
