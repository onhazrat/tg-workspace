import { Brain, ChevronDown, KeyRound, Languages } from "lucide-react"
import type React from "react"
import { useState } from "react"

import { ModelCombo } from "@/components/ai/ModelCombo"
import { LANGUAGES } from "@/constants"
import { useSettings } from "@/contexts/SettingsContext"
import { useAiKeys } from "@/hooks/useAiKeys"
import { rememberAiKeyId, selectedAiKeyId } from "@/lib/aiKeys/selection"

/**
 * Model and language, once, for the whole Action tab.
 *
 * These two selectors sat inside the Summary card while `AIContext`,
 * `TagContext` and `ChatContext` all read the same two `useSettings` values —
 * so changing the model for a tag run meant opening the summary form and
 * setting it there. The state was always shared; only the placement said
 * otherwise. Discover is the exception and does no inference at all: its report
 * is a server-side aggregation, so neither selector reaches it.
 *
 * The chevrons are not decoration. Language and Key are native `<select>`s
 * styled as chips, and `appearance: none` strips the platform's own dropdown
 * arrow — measured on staging, there was provably no affordance of any kind
 * without them. `pointer-events-none` keeps the click falling through.
 *
 * Model is a `ModelCombo` since BYOK-02, an `<input list>` rather than a
 * `<select>`, because the ids come from the account's own provider and an
 * endpoint that serves no catalogue still has to be typeable. Its chevron earns
 * its place for the same reason as the others: a datalist input looks exactly
 * like a text field until something says otherwise.
 *
 * The AI Key chip (BYOK-01) is the one control here that can be absent. With
 * fewer than two Keys there is nothing to choose between, so the common case
 * gets no extra step; the moment somebody holds a cheap Key and an expensive
 * one it appears, and the last used is pre-selected.
 */
export const RunSettingsBar: React.FC = () => {
  const { selectedModel, setSelectedModel, aiLanguage, setAiLanguage } =
    useSettings()
  const aiKeys = useAiKeys()
  const [aiKeyId, setAiKeyId] = useState<string | null>(selectedAiKeyId)
  const chooseAiKey = (id: string) => {
    setAiKeyId(id)
    rememberAiKeyId(id)
  }
  // A remembered id whose Key was deleted falls back to the first, rather than
  // leaving the chip showing a blank selection over a request that would 404.
  // `useAiKeysQuery` has already cleared the stored id by the time this runs,
  // so the fallback is what the request sends too — the chip and the wire
  // cannot disagree.
  const activeAiKeyId =
    aiKeys.find((k) => k.id === aiKeyId)?.id ?? aiKeys[0]?.id ?? ""

  return (
    <section
      data-testid="action-run-settings"
      className="flex flex-wrap items-center gap-3 rounded-xl border border-app-ink/10 bg-app-card p-4 shadow-sm"
    >
      <div className="mr-auto">
        <h3 className="text-sm font-bold uppercase tracking-tight">Run with</h3>
        <p className="mt-0.5 text-[11px] text-app-ink/60">
          Applies to summaries, tag runs and chats.
        </p>
      </div>

      <div className="flex h-10 items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted/20 px-3 transition-colors hover:bg-app-muted/30">
        <Brain size={14} className="text-app-ink/50" />
        <ModelCombo
          ariaLabel="Inference model"
          value={selectedModel}
          onChange={setSelectedModel}
          className="max-w-[160px] truncate bg-transparent font-mono text-xs focus:outline-none"
        />
        <ChevronDown
          size={12}
          aria-hidden="true"
          className="pointer-events-none shrink-0 text-app-ink/40"
        />
      </div>

      {aiKeys.length > 1 && (
        <div className="flex h-10 items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted/20 px-3 transition-colors hover:bg-app-muted/30">
          <KeyRound size={14} className="text-app-ink/50" />
          <select
            aria-label="AI key"
            value={activeAiKeyId}
            onChange={(e) => chooseAiKey(e.target.value)}
            className="max-w-[160px] cursor-pointer appearance-none truncate bg-transparent font-mono text-xs focus:outline-none"
            title="Which key pays for this run"
          >
            {aiKeys.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            aria-hidden="true"
            className="pointer-events-none shrink-0 text-app-ink/40"
          />
        </div>
      )}

      <div className="flex h-10 items-center gap-2 rounded-lg border border-app-ink/10 bg-app-muted/20 px-3 transition-colors hover:bg-app-muted/30">
        <Languages size={14} className="text-app-ink/50" />
        <select
          aria-label="Output language"
          value={aiLanguage}
          onChange={(e) => setAiLanguage(e.target.value)}
          className="max-w-[130px] cursor-pointer appearance-none truncate bg-transparent font-mono text-xs focus:outline-none"
          title="Output Language"
        >
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className="pointer-events-none shrink-0 text-app-ink/40"
        />
      </div>
    </section>
  )
}
