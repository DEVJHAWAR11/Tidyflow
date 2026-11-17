// Settings for the Library: Finder tags, and the rules TidyFlow learned from where you put files.
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import { ArrowRight } from "lucide-react";
import { Button, Card, SectionTitle, ease } from "../../flow/ui";
import { learnedRules, librarySettings, type LearnedRule, type LibrarySettings } from "./libraryApi";

const pretty = (path: string) => path.split("/").join(" / ");
const plural = (n: number, one: string) => `${n.toLocaleString()} ${n === 1 ? one : `${one}s`}`;

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

export function LibrarySettingsSection() {
  const [settings, setSettings] = useState<LibrarySettings | null>(null);
  const [rules, setRules] = useState<LearnedRule[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<{ text: string; error?: boolean } | null>(null);
  const [ruleError, setRuleError] = useState<string | null>(null);

  useEffect(() => {
    librarySettings.get().then(setSettings).catch(() => setSettings(null));
    learnedRules
      .list()
      .then((r) => setRules(r.rules))
      .catch(() => setRules([]));
  }, []);

  const toggleTags = async () => {
    if (!settings) return;
    const on = !settings.finder_tags;
    setSaving(true);
    setNote(null);
    try {
      const r = await librarySettings.setFinderTags(on);
      setSettings({ finder_tags: r.finder_tags, finder_tags_supported: settings.finder_tags_supported });
      const changed = on ? r.tagged : r.untagged;
      setNote({
        text:
          (on ? `Tagged ${plural(changed, "file")}.` : `Took TidyFlow's tags off ${plural(changed, "file")}.`) +
          (r.failed ? ` ${plural(r.failed, "file")} couldn't be changed.` : ""),
        error: r.failed > 0,
      });
    } catch (e) {
      setNote({ text: (e as Error).message, error: true });
    } finally {
      setSaving(false);
    }
  };

  const forget = async (rule: LearnedRule) => {
    setRuleError(null);
    try {
      await learnedRules.remove(rule.id);
      setRules((rs) => (rs ?? []).filter((r) => r.id !== rule.id));
    } catch (e) {
      setRuleError((e as Error).message);
    }
  };

  return (
    <div>
      <SectionTitle>Library</SectionTitle>
      <Card className="divide-y divide-tf-border overflow-hidden">
        {settings?.finder_tags_supported && (
          <div className="px-4 py-3.5">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-[13.5px] font-medium text-tf-ink">Tag files in Finder</div>
                <div className="text-[12.5px] text-tf-muted mt-0.5 max-w-[520px]">
                  Each file in a TidyFlow folder gets a Finder tag with the folder's name, so Finder and Spotlight
                  can find them too. Files don't move. Turning this off takes TidyFlow's tags away; yours stay.
                </div>
              </div>
              <Switch on={settings.finder_tags} disabled={saving} label="Tag files in Finder" onChange={toggleTags} />
            </div>
            {(saving || note) && (
              <p className={`mt-2 text-[12.5px] ${note?.error ? "text-tf-danger" : "text-tf-muted"}`}>
                {saving ? (settings.finder_tags ? "Taking the tags off…" : "Tagging your files…") : note?.text}
              </p>
            )}
          </div>
        )}

        <div className="px-4 py-3.5">
          <div className="text-[13.5px] font-medium text-tf-ink">Rules it learned from you</div>
          <div className="text-[12.5px] text-tf-muted mt-0.5 max-w-[520px]">
            When you put files somewhere other than where TidyFlow suggested, the Library offers a rule. Rules only
            suggest a folder; you still check every file.
          </div>
          {rules && rules.length > 0 && (
            <ul className="mt-3 rounded-[8px] border border-tf-border divide-y divide-tf-border">
              {rules.map((r) => (
                <li key={r.id} className="pl-3 pr-1.5 h-10 flex items-center gap-2 text-[13px]">
                  <span className="text-tf-ink-2 shrink-0">Names with</span>
                  <span className="font-medium text-tf-ink truncate">“{r.contains}”</span>
                  <ArrowRight size={13} strokeWidth={1.75} className="shrink-0 text-tf-faint" />
                  <span className="flex-1 min-w-0 truncate text-tf-ink" title={pretty(r.folder)}>
                    {pretty(r.folder)}
                  </span>
                  <Button size="sm" variant="ghost" onClick={() => forget(r)}>
                    Forget
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {rules && rules.length === 0 && <p className="mt-2 text-[12.5px] text-tf-faint">None yet.</p>}
          {ruleError && <p className="mt-2 text-[12.5px] text-tf-danger">{ruleError}</p>}
        </div>
      </Card>
    </div>
  );
}
