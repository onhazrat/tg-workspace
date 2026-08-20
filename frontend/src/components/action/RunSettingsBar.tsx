import { Brain, ChevronDown, Languages } from "lucide-react"
import type React from "react"

import { LANGUAGES, MODELS } from "@/constants"
import { useSettings } from "@/contexts/SettingsContext"

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
 * The chevrons are not decoration. These are native `<select>`s styled as
 * chips, and `appearance: none` strips the platform's own dropdown arrow —
 * measured on staging, there was provably no affordance of any kind without
 * them. `pointer-events-none` keeps the click falling through to the select.
 */
export const RunSettingsBar: React.FC = () => {
  const { selectedModel, setSelectedModel, aiLanguage, setAiLanguage } =
    useSettings()

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
        <select
          aria-label="Inference model"
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          className="max-w-[160px] cursor-pointer appearance-none truncate bg-transparent font-mono text-xs focus:outline-none"
          title="Inference Model"
        >
          {MODELS.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <ChevronDown
          size={12}
          aria-hidden="true"
          className="pointer-events-none shrink-0 text-app-ink/40"
        />
      </div>

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
