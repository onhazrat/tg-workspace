import {
  Brain,
  Copy,
  Languages,
  Loader2,
  Send,
  SlidersHorizontal,
} from "lucide-react"
import type React from "react"
import { LANGUAGES as APP_LANGUAGES, MODELS } from "../constants"
import { useAI } from "../contexts/AIContext"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useSettings } from "../contexts/SettingsContext"
import { useUI } from "../contexts/UIContext"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

export const SummaryConfig: React.FC = () => {
  const { channels } = useData()
  const { summarizing } = useUI()
  const { selectedModel, setSelectedModel, aiLanguage, setAiLanguage } =
    useSettings()
  const { scrapingChannels, filteredPosts } = useScraper()
  const { handleSummarize, copySummaryPrompt } = useAI()

  const actionsDisabled =
    scrapingChannels.size > 0 ||
    summarizing ||
    channels.length === 0 ||
    filteredPosts.length === 0

  return (
    <section className="bg-app-card rounded-xl border border-app-ink/10 shadow-sm overflow-hidden mb-6">
      {/* Header / Main Toolbar */}
      <div className="flex flex-col md:flex-row md:items-center justify-between p-4 gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-app-muted/30 flex items-center justify-center">
            <SlidersHorizontal size={18} className="opacity-60" />
          </div>
          <div>
            <h2 className="text-sm font-bold tracking-tight">
              Analysis Configuration
            </h2>
            <p className="text-[10px] text-app-ink/50 uppercase tracking-wider font-medium mt-0.5">
              Setup your summary parameters
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
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
          </div>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => void copySummaryPrompt()}
                disabled={actionsDisabled}
                className="flex items-center gap-2 px-4 h-10 border border-app-ink/10 rounded-lg hover:bg-app-muted/30 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Copy size={14} className="opacity-60" />
                <span className="text-xs font-bold tracking-wide">
                  Copy Prompt
                </span>
              </button>
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
              <button
                type="button"
                onClick={handleSummarize}
                disabled={actionsDisabled}
                className="flex items-center gap-2 px-6 h-10 bg-app-ink text-app-bg rounded-lg hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed group shadow-sm"
              >
                {summarizing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Send
                    size={14}
                    className="group-hover:translate-x-0.5 group-hover:-translate-y-0.5 transition-transform"
                  />
                )}
                <span className="text-xs font-bold tracking-wide">
                  Generate Summary
                </span>
              </button>
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
