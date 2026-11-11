// Choosing how TidyFlow reads files: TidyFlow AI (not available yet), the user's own key, or no AI.
// Used by the Settings page and by the first-run welcome, so both behave the same.
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, ExternalLink, KeyRound, Sparkles, HardDrive, Trash2, AlertTriangle } from "lucide-react";
import { API_BASE } from "../config";
import { Button, Pill, Dot, ease } from "../flow/ui";

export interface ProviderState {
  id: string;
  has_key: boolean;
  masked_key: string;
  /** The key comes from an environment variable, so the app can't remove it */
  from_env: boolean;
  model: string;
  key_url: string;
}

export interface AiSettings {
  provider: string;
  model: string;
  ai_enabled: boolean;
  has_key: boolean;
  masked_key: string;
  providers: ProviderState[];
  auto_copy_threshold: number;
  max_file_size_mb: number;
  ai_error?: string | null;
}

export interface SettingsChange {
  provider?: string;
  api_key?: string;
  model?: string;
  ai_enabled?: boolean;
  auto_copy_threshold?: number;
}

export const PROVIDER_INFO: Record<string, { name: string; note: string }> = {
  deepseek: { name: "DeepSeek", note: "Great value, very capable" },
  groq: { name: "Groq", note: "Very fast" },
  gemini: { name: "Google Gemini", note: "Google's AI" },
  openai: { name: "OpenAI", note: "The maker of ChatGPT" },
  openrouter: { name: "OpenRouter", note: "Many models, one key" },
};
export const providerName = (id: string) => PROVIDER_INFO[id]?.name ?? id;

async function errorText(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  const detail = data?.detail;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail) && detail[0]?.msg) return detail[0].msg;
  return "That didn't work. Try again.";
}

export interface AiSettingsHandle {
  settings: AiSettings | null;
  /** Friendly message while the AI is failing (key refused, no credit, no internet) */
  aiError: string | null;
  loadFailed: boolean;
  /** Save a change. Resolves to an error message, or null when it was saved. */
  change: (c: SettingsChange) => Promise<string | null>;
  removeKey: (provider: string) => Promise<string | null>;
  testKey: (provider: string) => Promise<{ ok: boolean; error: string | null }>;
  reload: () => Promise<void>;
}

/** Loads the settings and saves changes one at a time. `onChanged` runs after every successful save. */
export function useAiSettings(onChanged?: () => void): AiSettingsHandle {
  const [settings, setSettings] = useState<AiSettings | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const changed = useRef(onChanged);
  changed.current = onChanged;

  const take = (data: AiSettings) => {
    setSettings(data);
    if ("ai_error" in data) setAiError(data.ai_error || null);
  };

  const reload = useCallback(async () => {
    try {
      const [s, status] = await Promise.all([
        fetch(`${API_BASE}/settings`).then((r) => r.json()),
        fetch(`${API_BASE}/status`).then((r) => r.json()),
      ]);
      setSettings(s);
      setAiError(status.llm_error || null);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const send = useCallback(async (url: string, init: RequestInit): Promise<string | null> => {
    try {
      const res = await fetch(url, init);
      if (!res.ok) return await errorText(res);
      take(await res.json());
      changed.current?.();
      return null;
    } catch {
      return "TidyFlow's engine isn't answering. Check that the app is still running.";
    }
  }, []);

  const change = useCallback(
    (c: SettingsChange) =>
      send(`${API_BASE}/settings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(c),
      }),
    [send],
  );

  const removeKey = useCallback(
    (provider: string) => send(`${API_BASE}/settings/key?provider=${encodeURIComponent(provider)}`, { method: "DELETE" }),
    [send],
  );

  const testKey = useCallback(
    async (provider: string) => {
      try {
        const res = await fetch(`${API_BASE}/settings/test`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider }),
        });
        if (!res.ok) return { ok: false, error: await errorText(res) };
        const data = await res.json();
        await reload();
        changed.current?.();
        return { ok: !!data.ok, error: data.error || null };
      } catch {
        return { ok: false, error: "TidyFlow's engine isn't answering." };
      }
    },
    [reload],
  );

  return { settings, aiError, loadFailed, change, removeKey, testKey, reload };
}

/** One-line state of smart sorting, for the top of the Settings card. */
export function AiStatusPill({ ai }: { ai: AiSettingsHandle }) {
  const s = ai.settings;
  if (!s) return <Pill tone="neutral">…</Pill>;
  if (!s.ai_enabled) {
    return (
      <Pill tone="neutral">
        <Dot />
        <span>Off</span>
      </Pill>
    );
  }
  if (!s.has_key) {
    return (
      <Pill tone="warn">
        <Dot />
        <span>Needs a key</span>
      </Pill>
    );
  }
  if (ai.aiError) {
    return (
      <Pill tone="danger">
        <Dot />
        <span>Not working</span>
      </Pill>
    );
  }
  return (
    <Pill tone="success">
      <Dot />
      <span>Working · {providerName(s.provider)}</span>
    </Pill>
  );
}

type Mode = "tidyflow" | "own" | "off";

function ModeCard({
  selected,
  disabled,
  onClick,
  icon,
  title,
  note,
  badge,
}: {
  selected: boolean;
  disabled?: boolean;
  onClick?: () => void;
  icon: React.ReactNode;
  title: string;
  note: string;
  badge?: string;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-disabled={disabled}
      disabled={disabled}
      onClick={onClick}
      className={`relative text-left rounded-[10px] border p-3 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-ink ${
        disabled
          ? "border-tf-border bg-tf-surface-2/40 cursor-not-allowed"
          : selected
            ? "border-tf-ink bg-tf-surface-2 cursor-pointer"
            : "border-tf-border-strong bg-tf-surface hover:bg-tf-surface-2 cursor-pointer"
      }`}
    >
      <div className={`flex items-center gap-2 ${disabled ? "text-tf-muted" : "text-tf-ink"}`}>
        {icon}
        <span className="text-[13.5px] font-medium whitespace-nowrap">{title}</span>
        {selected && <Check size={15} strokeWidth={2} className="ml-auto shrink-0" />}
      </div>
      <p className="mt-1 text-[12.5px] leading-snug text-tf-muted">{note}</p>
      {badge && (
        <span className="mt-2 inline-block rounded-full bg-tf-surface-3 px-2 py-0.5 text-[11px] font-medium text-tf-muted">
          {badge}
        </span>
      )}
    </button>
  );
}

/** The three-way choice and, for "My own key", the provider list and key box. */
export function AiSetup({ ai }: { ai: AiSettingsHandle }) {
  const s = ai.settings;
  const [picked, setPicked] = useState<string | null>(null);
  const [keyInput, setKeyInput] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState<"save" | "test" | "remove" | "switch" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!s) {
    return (
      <p className="text-[13px] text-tf-muted">
        {ai.loadFailed ? "Couldn't load the settings. Check that TidyFlow is still running." : "Loading…"}
      </p>
    );
  }

  const mode: Mode = s.ai_enabled ? "own" : "off";
  const shown = picked ?? s.provider;
  const prov = s.providers.find((p) => p.id === shown) ?? s.providers[0];
  const isActive = prov.id === s.provider;
  const entering = !prov.has_key || replacing;

  const reset = () => {
    setKeyInput("");
    setReplacing(false);
    setError(null);
    setNote(null);
    setConfirmRemove(false);
  };

  const setMode = async (next: Mode) => {
    if (next === mode || next === "tidyflow") return;
    reset();
    setBusy("switch");
    setError(await ai.change({ ai_enabled: next === "own" }));
    setBusy(null);
  };

  const pick = async (id: string) => {
    reset();
    setPicked(id);
    const target = s.providers.find((p) => p.id === id);
    if (target?.has_key && id !== s.provider) {
      setBusy("switch");
      setError(await ai.change({ provider: id }));
      setBusy(null);
    }
  };

  const saveKey = async () => {
    const key = keyInput.trim();
    if (!key || busy) return;
    setBusy("save");
    setError(null);
    setNote(null);
    const problem = await ai.change({ provider: prov.id, api_key: key });
    setBusy(null);
    if (problem) {
      setError(problem);
      inputRef.current?.select();
      return;
    }
    setKeyInput("");
    setReplacing(false);
    setNote("Key saved and working.");
  };

  const test = async () => {
    setBusy("test");
    setError(null);
    setNote(null);
    const result = await ai.testKey(prov.id);
    setBusy(null);
    if (result.ok) setNote("The key works.");
    else setError(result.error || "The key didn't work.");
  };

  const remove = async () => {
    setBusy("remove");
    const problem = await ai.removeKey(prov.id);
    setBusy(null);
    reset();
    if (problem) setError(problem);
  };

  const openKeyPage = () => {
    // The engine opens it in the real web browser; the desktop window itself can't show other sites.
    fetch(`${API_BASE}/settings/key-page?provider=${prov.id}`, { method: "POST" })
      .then((r) => r.json())
      .then((d) => {
        if (!d.opened) window.open(prov.key_url, "_blank", "noopener");
      })
      .catch(() => window.open(prov.key_url, "_blank", "noopener"));
  };

  return (
    <div className="space-y-4">
      <div role="radiogroup" aria-label="How TidyFlow reads your files" className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <ModeCard
          selected={false}
          disabled
          icon={<Sparkles size={15} strokeWidth={1.75} />}
          title="TidyFlow AI"
          note="Nothing to set up. We run the AI for you."
          badge="Coming soon"
        />
        <ModeCard
          selected={mode === "own"}
          onClick={() => setMode("own")}
          icon={<KeyRound size={15} strokeWidth={1.75} />}
          title="My own key"
          note="Use your own account with an AI service. You pay them directly."
        />
        <ModeCard
          selected={mode === "off"}
          onClick={() => setMode("off")}
          icon={<HardDrive size={15} strokeWidth={1.75} />}
          title="No AI"
          note="Sort by file type and name only. Nothing leaves this computer."
        />
      </div>

      <AnimatePresence initial={false}>
        {mode === "own" && (
          <motion.div
            key="own"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease }}
            className="overflow-hidden"
          >
            <div className="space-y-3 pt-0.5">
              <div>
                <div className="text-[13px] font-medium text-tf-ink">AI service</div>
                <div className="text-[12.5px] text-tf-muted">
                  TidyFlow sends file names and short text excerpts to the service you pick. Each service keeps its own key.
                </div>
              </div>

              <div role="radiogroup" aria-label="AI service" className="rounded-[10px] border border-tf-border divide-y divide-tf-border overflow-hidden">
                {s.providers.map((p) => {
                  const selected = p.id === shown;
                  const inUse = p.id === s.provider && p.has_key;
                  return (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => pick(p.id)}
                      className={`w-full h-11 px-3.5 flex items-center gap-3 text-left transition-colors cursor-pointer hover:bg-tf-surface-2 focus-visible:outline-none focus-visible:bg-tf-surface-2 ${
                        selected ? "bg-tf-surface-2/70" : "bg-tf-surface"
                      }`}
                    >
                      <span
                        className={`w-4 h-4 rounded-full shrink-0 transition-all ${
                          selected ? "border-[5px] border-tf-primary bg-tf-surface" : "border border-tf-border-strong bg-tf-surface"
                        }`}
                      />
                      <span className="text-[13.5px] font-medium text-tf-ink">{providerName(p.id)}</span>
                      <span className="ml-auto flex items-center gap-1.5 text-[12.5px] text-tf-muted truncate">
                        {inUse ? (
                          <span className="text-tf-success inline-flex items-center gap-1">
                            <Check size={13} strokeWidth={2} /> In use
                          </span>
                        ) : p.has_key ? (
                          <span className="inline-flex items-center gap-1">
                            <Check size={13} strokeWidth={2} /> Key saved
                          </span>
                        ) : (
                          <span className="hidden sm:inline">{PROVIDER_INFO[p.id]?.note}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Key for the picked service */}
              <div className="rounded-[10px] border border-tf-border bg-tf-surface-2/40 p-3.5 space-y-2.5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="tf-api-key" className="text-[13px] font-medium text-tf-ink">
                    {providerName(prov.id)} key
                  </label>
                  <button
                    type="button"
                    onClick={openKeyPage}
                    className="inline-flex items-center gap-1 text-[12.5px] text-tf-link hover:underline cursor-pointer"
                  >
                    Get a key <ExternalLink size={12} strokeWidth={1.75} />
                  </button>
                </div>

                {entering ? (
                  <>
                    <form
                      className="flex gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveKey();
                      }}
                    >
                      <div className="relative flex-1 min-w-0">
                        <KeyRound
                          size={15}
                          strokeWidth={1.75}
                          className="absolute left-3 top-1/2 -translate-y-1/2 text-tf-faint pointer-events-none"
                        />
                        <input
                          id="tf-api-key"
                          ref={inputRef}
                          type="password"
                          value={keyInput}
                          onChange={(e) => {
                            setKeyInput(e.target.value);
                            setError(null);
                          }}
                          placeholder={`Paste your ${providerName(prov.id)} key`}
                          autoComplete="off"
                          spellCheck={false}
                          aria-invalid={!!error}
                          className={`w-full h-9 rounded-[8px] pl-9 pr-3 text-[13.5px] bg-tf-surface border text-tf-ink placeholder:text-tf-faint focus:outline-none focus:ring-1 transition-colors font-mono ${
                            error
                              ? "border-tf-danger focus:border-tf-danger focus:ring-tf-danger"
                              : "border-tf-border-strong focus:border-tf-ink focus:ring-tf-ink"
                          }`}
                        />
                      </div>
                      <Button type="submit" variant="primary" size="md" disabled={!keyInput.trim() || busy !== null}>
                        {busy === "save" ? "Checking…" : "Save key"}
                      </Button>
                      {replacing && (
                        <Button type="button" variant="ghost" size="md" onClick={reset}>
                          Cancel
                        </Button>
                      )}
                    </form>
                    <p className="text-[12.5px] text-tf-muted">
                      The key is tried first and only saved if {providerName(prov.id)} accepts it. It stays on this computer.
                      {!isActive && s.has_key && ` TidyFlow keeps using ${providerName(s.provider)} until then.`}
                    </p>
                  </>
                ) : (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                    <span className="text-[12.5px] text-tf-muted mr-auto">
                      <span className="font-mono text-tf-ink-2">{prov.masked_key}</span>
                      {prov.from_env ? " · set outside the app" : " · saved only on this computer"}
                    </span>
                    {confirmRemove ? (
                      <>
                        <span className="text-[12.5px] text-tf-ink">Remove this key?</span>
                        <Button variant="danger" size="sm" onClick={remove} disabled={busy !== null}>
                          {busy === "remove" ? "Removing…" : "Remove"}
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)}>
                          Keep
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button variant="secondary" size="sm" onClick={test} disabled={busy !== null}>
                          {busy === "test" ? "Testing…" : "Test"}
                        </Button>
                        {!prov.from_env && (
                          <>
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => {
                                reset();
                                setReplacing(true);
                                requestAnimationFrame(() => inputRef.current?.focus());
                              }}
                            >
                              Replace
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              icon={<Trash2 size={13} strokeWidth={1.75} />}
                              onClick={() => setConfirmRemove(true)}
                            >
                              Remove
                            </Button>
                          </>
                        )}
                      </>
                    )}
                  </div>
                )}

                <div aria-live="polite">
                  {error ? (
                    <p className="flex items-start gap-1.5 text-[12.5px] text-tf-danger">
                      <AlertTriangle size={14} strokeWidth={1.75} className="shrink-0 mt-px" />
                      {error}
                    </p>
                  ) : note ? (
                    <p className="flex items-center gap-1.5 text-[12.5px] text-tf-success">
                      <Check size={14} strokeWidth={2} />
                      {note}
                    </p>
                  ) : isActive && prov.has_key && ai.aiError && !entering ? (
                    <p className="flex items-start gap-1.5 text-[12.5px] text-tf-danger">
                      <AlertTriangle size={14} strokeWidth={1.75} className="shrink-0 mt-px" />
                      {ai.aiError}
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {mode === "off" && (
        <p className="text-[12.5px] text-tf-muted">
          Files are sorted by their type and name. Anything TidyFlow isn't sure about is left for you to review.
          {s.providers.some((p) => p.has_key) && " Your saved keys are kept for when you turn AI back on."}
        </p>
      )}
      {mode === "off" && error && <p className="text-[12.5px] text-tf-danger">{error}</p>}
    </div>
  );
}
