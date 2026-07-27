import {
  Brain,
  ChevronDown,
  Copy,
  Languages,
  Send,
  SlidersHorizontal,
} from "lucide-react"
import type React from "react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { LANGUAGES as APP_LANGUAGES, MODELS } from "../constants"
import { useAI } from "../contexts/AIContext"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { useScopedPostCounts } from "../hooks/usePostsView"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

export const SummaryConfig: React.FC = () => {
  const { channels } = useData()
  const { summarizing } = useUI()
  const { selectedModel, setSelectedModel, aiLanguage, setAiLanguage } =
    useSettings()
  const { scrapingChannels } = useScraper()
  const { handleSummarize, copySummaryPrompt } = useAI()
  const [copyingPrompt, setCopyingPrompt] = useState(false)

  const postsInScopeCounts = useScopedPostCounts()
  const hasPostsInScope = Object.values(postsInScopeCounts).some((n) => n > 0)

  const actionsDisabled =
    scrapingChannels.size > 0 ||
    summarizing ||
    copyingPrompt ||
    channels.length === 0 ||
    !hasPostsInScope

  const handleCopyPrompt = async () => {
    setCopyingPrompt(true)
    try {
      await copySummaryPrompt()
    } finally {
      setCopyingPrompt(false)
    }
  }

  return (
    <section className="bg-app-card rounded-xl border border-app-ink/10 shadow-sm overflow-hidden mb-6">
      {/* Header / Main Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between p-4 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-app-muted/30 flex items-center justify-center">
            <SlidersHorizontal size={18} className="opacity-60" />
          </div>
          <div>
            {/*
             * Named for what it is. "Analysis Configuration — setup your
             * summary parameters" promises a configuration surface; the row
             * holds exactly two selectors, model and language, and the actual
             * scope (channels, dates, filters) is set on other tabs entirely.
             */}
            <h2 className="text-sm font-bold tracking-tight">Summary</h2>
            <p className="text-[10px] text-app-ink/50 uppercase tracking-wider font-medium mt-0.5">
              Model and language for the next run
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {/*
           * The chevrons are not decoration.
           *
           * These are native `<select>`s styled as chips, and `appearance:
           * none` strips the platform's own dropdown arrow. With no
           * replacement they rendered identically to the static labels beside
           * them — nothing said they could be opened. Measured on staging:
           * `appearance: none`, `background-image: none`, `padding-right: 0`,
           * so there was provably no affordance of any kind.
           *
           * `pointer-events-none` on the icon keeps the click falling through
           * to the select underneath it.
           */}
          <div className="flex items-center bg-app-muted/20 border border-app-ink/10 rounded-lg px-3 h-10 gap-2 hover:bg-app-muted/30 transition-colors">
            <Brain size={14} className="text-app-ink/50" />
            <select
              value={selectedModel}
              onChange={(e) => setSelectedModel(e.target.value)}
              className="bg-transparent focus:outline-none text-xs font-mono appearance-none cursor-pointer max-w-[140px] truncate"
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
              className="text-app-ink/40 pointer-events-none shrink-0"
            />
          </div>

          <div className="flex items-center bg-app-muted/20 border border-app-ink/10 rounded-lg px-3 h-10 gap-2 hover:bg-app-muted/30 transition-colors">
            <Languages size={14} className="text-app-ink/50" />
            <select
              value={aiLanguage}
              onChange={(e) => setAiLanguage(e.target.value)}
              className="bg-transparent focus:outline-none text-xs font-mono appearance-none cursor-pointer max-w-[120px] truncate"
              title="Output Language"
            >
              {APP_LANGUAGES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              aria-hidden="true"
              className="text-app-ink/40 pointer-events-none shrink-0"
            />
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <TgButton
                type="button"
                variant="secondary"
                size="md"
                onClick={() => void handleCopyPrompt()}
                disabled={actionsDisabled}
                loading={copyingPrompt}
                loadingLabel="Copying…"
                className="h-10 px-4"
              >
                <Copy size={14} className="opacity-60" />
                Copy Prompt
              </TgButton>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                Copies the prompt to your clipboard and creates a history entry
                awaiting the external AI response.
              </p>
            </TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <TgButton
                type="button"
                variant="primary"
                size="md"
                onClick={handleSummarize}
                disabled={actionsDisabled}
                loading={summarizing}
                loadingLabel="Generate Summary"
                className="h-10 px-6 group"
              >
                <Send
                  size={14}
                  className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
                />
                Generate Summary
              </TgButton>
            </TooltipTrigger>
            <TooltipContent>
              <p>
                Analyzes the selected posts and creates a new summary using AI.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    </section>
  )
}
