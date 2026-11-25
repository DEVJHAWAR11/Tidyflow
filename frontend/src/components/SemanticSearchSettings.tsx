// Settings › Search by meaning: turn it on, pick a model to download, watch it download and index.
import { useState } from "react";
import { motion } from "motion/react";
import { AlertCircle, Check } from "lucide-react";
import { Button, Card, SectionTitle, ease } from "../flow/ui";
import { formatMB, semanticApi, useSemanticStatus, type SemanticModel, type SemanticStatus } from "./semanticApi";

function Switch({ on, disabled, label, onChange }: { on: boolean; disabled?: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={`relative inline-flex items-center w-8 h-[18px] rounded-full transition-colors duration-150 cursor-pointer shrink-0 disabled:opacity-50 disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-ink ${
        on ? "bg-tf-primary" : "bg-tf-surface-3"
      }`}
    >
      <motion.span
        layout
        transition={{ duration: 0.15, ease }}
        className={`block w-3.5 h-3.5 rounded-full ${on ? "bg-tf-on-primary" : "bg-white"} shadow-sm ml-0.5 ${
          on ? "translate-x-3.5" : "translate-x-0"
        }`}
      />
    </button>
  );
}

function Bar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-1.5 rounded-full bg-tf-surface-2 overflow-hidden"
    >
      <div className="h-full bg-tf-ink transition-[width] duration-300" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ModelChoices({
  models,
  picked,
  current,
  onPick,
}: {
  models: SemanticModel[];
  picked: string;
  current: string | null;
  onPick: (key: string) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Model" className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
      {models.map((m) => {
        const on = picked === m.key;
        return (
          <button
            key={m.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onPick(m.key)}
            className={`text-left rounded-[10px] border p-3 flex flex-col gap-1 min-w-0 cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tf-ink ${
              on ? "border-tf-ink ring-1 ring-tf-ink" : "border-tf-border-strong hover:bg-tf-surface-2/50"
            }`}
          >
            <span className="flex items-center gap-2 flex-wrap text-[13.5px] font-medium text-tf-ink">
              {m.label}
              {m.recommended && (
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-tf-surface-2 text-tf-ink-2">Recommended</span>
              )}
              {current === m.key && (
                <span className="text-[11px] font-medium px-1.5 py-0.5 rounded-full bg-tf-success-soft text-tf-success">In use</span>
              )}
            </span>
            <span className="text-[12px] text-tf-faint tf-num">
              {formatMB(m.size_bytes)} {m.downloaded ? "· downloaded" : "download"}
            </span>
            <span className="text-[12.5px] text-tf-muted leading-snug">{m.blurb}</span>
          </button>
        );
      })}
    </div>
  );
}

const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

export function SemanticSearchSettings() {
  const { status, setStatus, loadFailed } = useSemanticStatus();
  const [choosing, setChoosing] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const run = async (action: () => Promise<SemanticStatus>, after?: (s: SemanticStatus) => void) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      const s = await action();
      setStatus(s);
      after?.(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "That didn't work. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (!status) {
    return (
      <div>
        <SectionTitle>Search by meaning</SectionTitle>
        <Card className="p-4 text-[13px] text-tf-muted">
          {loadFailed ? "Couldn't load this setting. Reopen Settings to try again." : "Loading…"}
        </Card>
      </div>
    );
  }

  const models = status.models;
  const choice = picked ?? status.model;
  const chosen = models.find((m) => m.key === choice) ?? models[0];
  const inUse = models.find((m) => m.key === status.model);
  const showChoices = choosing || (!status.enabled && picked !== null);

  const toggle = () => {
    if (status.enabled) {
      setChoosing(false);
      setPicked(null);
      run(semanticApi.disable);
    } else if (models.some((m) => m.key === status.model && m.downloaded)) {
      // Already downloaded: back on straight away.
      run(() => semanticApi.enable(status.model));
    } else {
      setPicked(status.model);
    }
  };

  const confirmChoice = () => run(() => semanticApi.enable(chosen.key), () => {
    setChoosing(false);
    setPicked(null);
  });

  const remove = () =>
    run(semanticApi.remove, (s) => {
      setConfirmRemove(false);
      const freed = (s as SemanticStatus & { freed_bytes?: number }).freed_bytes ?? 0;
      setNote(freed > 0 ? `Removed. ${formatMB(freed)} freed.` : "Removed.");
    });

  return (
    <div>
      <SectionTitle>Search by meaning</SectionTitle>
      <Card className="divide-y divide-tf-border overflow-hidden">
        <div className="px-4 py-3.5 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-[13.5px] font-medium text-tf-ink">Find files by what they're about</div>
            <div className="text-[12.5px] text-tf-muted mt-0.5">
              Search also finds files that mean what you typed, not only ones with the same words. It runs on this
              computer; nothing is sent anywhere.
            </div>
          </div>
          <Switch
            on={status.enabled || showChoices}
            disabled={busy || (!status.engine_available && !status.enabled)}
            label="Search by meaning"
            onChange={() => (showChoices && !status.enabled ? setPicked(null) : toggle())}
          />
        </div>

        {!status.engine_available && (
          <div className="px-4 py-3 text-[12.5px] text-tf-muted flex gap-2">
            <AlertCircle size={14} strokeWidth={1.75} className="mt-0.5 shrink-0 text-tf-warn" />
            This copy of TidyFlow doesn't include the search-by-meaning engine. Install the latest version to use it.
          </div>
        )}

        {showChoices && (
          <div className="p-4 flex flex-col gap-3 bg-tf-surface-2/20">
            <div className="text-[13px] font-medium text-tf-ink">Choose a model to download</div>
            <ModelChoices models={models} picked={chosen.key} current={status.enabled ? status.model : null} onPick={setPicked} />
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setChoosing(false); setPicked(null); }} disabled={busy}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={confirmChoice} disabled={busy || (status.enabled && chosen.key === status.model)}>
                {chosen.downloaded ? `Use ${chosen.label}` : `Download ${formatMB(chosen.size_bytes)}`}
              </Button>
            </div>
            {status.enabled && chosen.key !== status.model && (
              <p className="text-[12px] text-tf-muted">
                Switching model makes the meaning index again, and the old model is deleted once the new one is ready.
              </p>
            )}
          </div>
        )}

        {status.enabled && status.phase === "downloading" && (
          <div className="p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-tf-ink">Downloading {inUse?.label ?? "model"}</span>
              <span className="text-tf-faint tf-num">
                {formatMB(status.download.done)} / {formatMB(status.download.total)}
              </span>
            </div>
            <Bar done={status.download.done} total={status.download.total} label="Download progress" />
            <div className="flex items-center justify-between gap-3">
              <span className="text-[12px] text-tf-muted">Then TidyFlow reads your files' text to build the meaning index.</span>
              <Button variant="secondary" size="sm" onClick={() => run(semanticApi.cancel)} disabled={busy}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {status.enabled && status.phase === "indexing" && (
          <div className="p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-3 text-[13px]">
              <span className="text-tf-ink">Building the meaning index</span>
              <span className="text-tf-faint tf-num">
                {status.index.done.toLocaleString()} / {plural(status.index.total, "file")}
              </span>
            </div>
            <Bar done={status.index.done} total={status.index.total} label="Indexing progress" />
            <span className="text-[12px] text-tf-muted">Search keeps working meanwhile; meaning results fill in as files are done.</span>
          </div>
        )}

        {status.enabled && status.phase === "error" && (
          <div className="p-4 flex items-start justify-between gap-3">
            <div className="flex gap-2 text-[13px] text-tf-danger min-w-0">
              <AlertCircle size={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
              <span>{status.error ?? "Something went wrong."}</span>
            </div>
            <Button variant="secondary" size="sm" onClick={() => run(semanticApi.retry)} disabled={busy} className="shrink-0">
              Try again
            </Button>
          </div>
        )}

        {status.enabled && status.phase === "ready" && !choosing && (
          <div className="p-4 flex flex-col gap-3">
            <div className="flex gap-2 text-[13px] text-tf-ink">
              <Check size={15} strokeWidth={2} className="mt-0.5 shrink-0 text-tf-success" />
              <span>
                Ready. {plural(status.index.vectors, "file")} with text can be found by meaning, using the{" "}
                {inUse?.label.toLowerCase() ?? ""} model.
              </span>
            </div>
            <p className="text-[12px] text-tf-muted leading-snug">
              It reads the same text keyword search uses, which is the first few thousand characters of each file. Files
              with no text, like most photos, are still found by name.
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <Button variant="secondary" size="sm" onClick={() => { setChoosing(true); setPicked(status.model); }} disabled={busy}>
                Change model
              </Button>
              {!confirmRemove ? (
                <Button variant="danger" size="sm" onClick={() => setConfirmRemove(true)} disabled={busy}>
                  Remove model
                </Button>
              ) : (
                <span className="inline-flex items-center gap-2 text-[12.5px] text-tf-ink">
                  Delete the model ({formatMB(inUse?.size_bytes ?? 0)}) and the meaning index?
                  <Button variant="danger" size="sm" onClick={remove} disabled={busy}>
                    Delete
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)} disabled={busy}>
                    Keep
                  </Button>
                </span>
              )}
            </div>
          </div>
        )}

        {!status.enabled && !showChoices && models.some((m) => m.downloaded) && (
          <div className="px-4 py-3 flex items-center justify-between gap-3">
            <span className="text-[12.5px] text-tf-muted">
              The model is still downloaded, so turning this back on is instant.
            </span>
            {!confirmRemove ? (
              <Button variant="danger" size="sm" onClick={() => setConfirmRemove(true)} disabled={busy} className="shrink-0">
                Remove model
              </Button>
            ) : (
              <span className="inline-flex items-center gap-2 shrink-0">
                <Button variant="danger" size="sm" onClick={remove} disabled={busy}>
                  Delete
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmRemove(false)} disabled={busy}>
                  Keep
                </Button>
              </span>
            )}
          </div>
        )}

        {(error || note) && (
          <div className={`px-4 py-2.5 text-[12.5px] ${error ? "text-tf-danger" : "text-tf-muted"}`}>{error ?? note}</div>
        )}
      </Card>
    </div>
  );
}
