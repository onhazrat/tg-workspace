import { Copy, FileText, Send } from "lucide-react"
import type React from "react"
import { useState } from "react"

import { ActionIconButton, ActionRow } from "@/components/action/ActionRow"
import { TgButton } from "@/components/ui/tg-button"
import { useAI } from "@/contexts/AIContext"
import { useData } from "@/contexts/DataContext"
import { useScraper } from "@/contexts/ScraperContext"
import { useUI } from "@/contexts/UIContext"
import { useSelectedAiKeyId } from "@/hooks/useAiKeys"
import { useScopedPostCounts } from "@/hooks/usePostsView"

/** Both actions wait for any scrape or run in flight and need posts to read. */
export function summaryActionsDisabled(state: {
  scraping: boolean
  summarizing: boolean
  copyingPrompt: boolean
  hasChannels: boolean
  hasPostsInScope: boolean
}): boolean {
  return (
    state.scraping ||
    state.summarizing ||
    state.copyingPrompt ||
    !state.hasChannels ||
    !state.hasPostsInScope
  )
}

/**
 * The two ways to start a summary: run it here, or copy the prompt and paste
 * the answer back from History.
 */
export const SummaryAction: React.FC = () => {
  const { channels } = useData()
  const { summarizing } = useUI()
  const { scrapingChannels } = useScraper()
  const { handleSummarize, copySummaryPrompt } = useAI()
  const [copyingPrompt, setCopyingPrompt] = useState(false)

  const postsInScopeCounts = useScopedPostCounts()
  const hasPostsInScope = Object.values(postsInScopeCounts).some((n) => n > 0)

  // Only the run spends a Key. `/ai/summary/prompt` never calls
  // `resolve_ai_key`, so copying the prompt is the path that still works with
  // no Key at all — gating it too would leave a keyless account with nothing.
  const noKey = useSelectedAiKeyId() === null

  const actionsDisabled = summaryActionsDisabled({
    scraping: scrapingChannels.size > 0,
    summarizing,
    copyingPrompt,
    hasChannels: channels.length > 0,
    hasPostsInScope,
  })

  const handleCopyPrompt = async () => {
    setCopyingPrompt(true)
    try {
      await copySummaryPrompt()
    } finally {
      setCopyingPrompt(false)
    }
  }

  return (
    <ActionRow
      icon={FileText}
      title="Summarize"
      description="AI prose over every post in the current scope."
      secondary={
        <ActionIconButton
          icon={Copy}
          label="Copy summary prompt"
          hint="Copies the prompt to your clipboard and creates a history entry awaiting the external AI response."
          onClick={() => void handleCopyPrompt()}
          disabled={actionsDisabled}
          loading={copyingPrompt}
        />
      }
      primary={
        <TgButton
          onClick={handleSummarize}
          disabled={actionsDisabled || noKey}
          title={noKey ? "Add an AI key above to run this." : undefined}
          loading={summarizing}
          loadingLabel="Generating…"
        >
          <Send size={13} />
          Generate summary
        </TgButton>
      }
    />
  )
}
