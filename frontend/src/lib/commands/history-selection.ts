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
  // Opening a saved report restores the *view*, never the user's generation
  // settings. Neither the model nor the language is written back: the model
  // selector and the language selector both mean "for the next generation", and
  // a read must not rewrite them. `SummaryView` renders the record's own model
  // (`formatSummaryModelLabel`) and its own direction (`reportDirection`) from
  // the record itself, so nothing global needs to change for it to display right.
  ctx.setSummary(isPendingSummary(summary) ? null : summary.text)
  ctx.setDateRange(summary.startDate, summary.endDate)
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
