import { isPendingSummary } from "@/constants"
import type { Summary, SummaryListItem, TabType } from "@/types"

export interface HistorySummarySelectionContext {
  setActiveTab: (tab: TabType) => void
  setDateRange: (start: number, end: number) => void
  setSelectedChannels: (channels: Set<string>) => void
  setChatMessages: (
    messages: { role: "user" | "model"; text: string }[],
  ) => void
  setCurrentSummaryId: (id: string | null) => void
  setPostSearch: (query: string) => void
  setSemanticSearchQuery: (query: string) => void
  setSemanticSearchRespectsTimeRange: (value: boolean) => void
  setSemanticSearchRespectsChannels: (value: boolean) => void
  setRelatedPostSearch: (post: null) => void
  setSummary: (text: string | null) => void
  /** Fetches the full record; the list projection omits `chatMessages`. */
  loadDetail: (id: string) => Promise<Summary | undefined>
  settings: {
    setAiLanguage: (language: string) => void
  }
}

/**
 * `summary` may be a list row, which has no `chatMessages` — the chat restore
 * below needs the full record, so callers pass `loadDetail` to fetch it. It is
 * awaited only when the summary looks like a chat, so ordinary selection stays
 * a single synchronous-feeling step.
 */
export async function applyHistorySummarySelection(
  summary: SummaryListItem | Summary,
  ctx: HistorySummarySelectionContext,
): Promise<void> {
  ctx.setSummary(isPendingSummary(summary) ? null : summary.text)
  ctx.setDateRange(summary.startDate, summary.endDate)
  // `setAiLanguage` stays: it drives the direction and font the loaded report is
  // rendered with. `setSelectedModel` deliberately does not — the model selector
  // means "model for the next generation", and opening a saved report must not
  // silently rewrite it. The report's own model is rendered from the record, via
  // `formatSummaryModelLabel(currentSummary.model)` in `SummaryView`.
  ctx.settings.setAiLanguage(summary.language)
  ctx.setSelectedChannels(new Set(summary.channels || []))
  ctx.setCurrentSummaryId(summary.id)
  ctx.setPostSearch(summary.postSearch || "")
  ctx.setSemanticSearchQuery(summary.semanticSearchQuery || "")
  ctx.setSemanticSearchRespectsTimeRange(
    summary.semanticSearchRespectsTimeRange || false,
  )
  ctx.setSemanticSearchRespectsChannels(
    summary.semanticSearchRespectsChannels || false,
  )
  ctx.setRelatedPostSearch(null)

  // Only a chat-shaped summary needs the heavy record; everything else avoids
  // the extra request entirely.
  if (!summary.text.startsWith("Chat: ")) {
    ctx.setChatMessages([])
    ctx.setActiveTab("summary")
    return
  }

  const detail =
    "chatMessages" in summary ? summary : await ctx.loadDetail(summary.id)
  const chatMessages = detail?.chatMessages ?? []
  ctx.setChatMessages(chatMessages)

  // Preserve the original condition: a chat with an explicitly empty message
  // list falls through to the summary tab.
  if (!detail?.chatMessages || chatMessages.length > 0) {
    ctx.setActiveTab("chat")
    return
  }

  ctx.setActiveTab("summary")
}
