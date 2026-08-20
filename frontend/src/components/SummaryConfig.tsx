import { Copy, Send } from "lucide-react"
import type React from "react"
import { useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import { useAI } from "../contexts/AIContext"
import { useData } from "../contexts/DataContext"
import { useScraper } from "../contexts/ScraperContext"
import { useUI } from "../contexts/UIContext"
import { useScopedPostCounts } from "../hooks/usePostsView"
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tg-tooltip"

/**
 * The two ways to start a summary.
 *
 * Model and language used to live here, in a card with its own header, nested
 * inside the Action tab's own Summary card. They are shared settings that three
 * of the four actions read, so they moved up to `RunSettingsBar` and this is
 * what was left: run it here, or copy the prompt and paste the answer back.
 */
export const SummaryConfig: React.FC = () => {
  const { channels } = useData()
  const { summarizing } = useUI()
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
    <div className="flex flex-wrap items-center justify-end gap-3">
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
            Copy Summary Prompt
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
            className="group h-10 px-6"
          >
            <Send
              size={14}
              className="transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
            />
            Generate Summary
          </TgButton>
        </TooltipTrigger>
        <TooltipContent>
          <p>Analyzes the selected posts and creates a new summary using AI.</p>
        </TooltipContent>
      </Tooltip>
    </div>
  )
}
