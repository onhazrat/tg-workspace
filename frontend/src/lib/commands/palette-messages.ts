import {
  isNonChannelEntityFlow,
  isSettingGroupEntityFlow,
} from "@/lib/commands/entity-candidates"
import type { EntityFlowType } from "@/lib/commands/types"

/** Screen-reader announcement after a stay-open entity pick. */
export function getStayOpenAnnouncement(flow: EntityFlowType): string {
  switch (flow) {
    case "select-channel":
      return "Channel selected, palette open"
    case "deselect-channel":
      return "Channel deselected, palette open"
    case "freeze-channel":
      return "Channel frozen, palette open"
    case "unfreeze-channel":
      return "Channel unfrozen, palette open"
    case "toggle-auto-follow":
      return "Auto-follow toggled, palette open"
    case "fix-partial-history-channel":
      return "Partial history fix queued, palette open"
    default:
      return "Selection updated, palette open"
  }
}

/** Empty-state copy for the entity sub-view list. */
export function getEntityEmptyMessage(
  flow: EntityFlowType,
  hasQuery: boolean,
): string {
  if (flow === "deselect-channel" && !hasQuery) {
    return "No channels selected."
  }
  if (flow === "fix-partial-history-channel" && !hasQuery) {
    return "No channels with partial history."
  }
  if (flow === "pick-post") {
    return "No posts in current filter. Try widening the date range."
  }
  if (flow === "delete-summary") {
    return "No summaries in history."
  }
  if (flow === "remove-tag-pick") {
    return "No tags on this channel."
  }
  if (isSettingGroupEntityFlow(flow)) {
    return "No setting groups found."
  }
  return "No matches found."
}

/** Group heading for the entity sub-view list. */
export function getEntityGroupHeading(flow: EntityFlowType): string {
  if (!isNonChannelEntityFlow(flow)) return "Channels"
  if (flow === "delete-summary") return "Summaries"
  if (flow === "pick-post") return "Posts"
  if (flow === "clear-db-table") return "Tables"
  if (isSettingGroupEntityFlow(flow)) return "Setting Groups"
  return "Tags"
}

/** Search-input placeholder for the entity sub-view. */
export function getEntityInputPlaceholder(flow: EntityFlowType): string {
  return isNonChannelEntityFlow(flow)
    ? "Filter..."
    : "Name, display name, tag, #tag, or tag:tag..."
}

/** Empty-state copy for the search-results sub-view. */
export function getSearchResultsEmptyMessage(query: string): string {
  return query.trim()
    ? "No matching results. Try a different query or widen the date range."
    : "No results in the current date range or history."
}

/** Header label for the search-results sub-view. */
export function getSearchResultsHeaderLabel(
  commandLabel: string,
  query: string,
): string {
  return `${commandLabel}${query ? ` — "${query}"` : ""}`
}

/** Keyboard hints footer for the editor sub-view. */
export function getEditorFooterHint(isTextarea: boolean): string {
  return isTextarea
    ? "⌃↵ apply · esc back · ⌫ parent"
    : "↵ apply · esc back · ⌫ parent"
}
