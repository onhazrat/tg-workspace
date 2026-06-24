import { isPastedSummaryModel, isPendingSummary } from "@/constants"
import type { Summary, TabType } from "@/types"

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
  settings: {
    setAiLanguage: (language: string) => void
    setSelectedModel: (model: string) => void
  }
}

export function applyHistorySummarySelection(
  summary: Summary,
  ctx: HistorySummarySelectionContext,
): void {
  ctx.setSummary(isPendingSummary(summary) ? null : summary.text)
  ctx.setDateRange(summary.startDate, summary.endDate)
  ctx.settings.setAiLanguage(summary.language)
  if (summary.model && !isPastedSummaryModel(summary.model)) {
    ctx.settings.setSelectedModel(summary.model)
  }
  ctx.setSelectedChannels(new Set(summary.channels || []))
  ctx.setChatMessages(summary.chatMessages || [])
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

  if (
    summary.text.startsWith("Chat: ") &&
    (!summary.chatMessages || summary.chatMessages.length > 0)
  ) {
    ctx.setActiveTab("chat")
    return
  }

  ctx.setActiveTab("summary")
}
