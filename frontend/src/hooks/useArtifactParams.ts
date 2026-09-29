import { getRouteApi } from "@tanstack/react-router"

const workspaceRoute = getRouteApi("/_tg/workspace")

/**
 * Which Summary, Chat session, Tag run or Discover report the active tab holds.
 *
 * Read from the URL, where `validateWorkspaceSearch` keeps only the active
 * tab's Artifact param (TABS-01), so each is null on every other tab and on an
 * empty one. Nothing writes these params directly: opening or creating an
 * Artifact goes through `useWorkspaceTabs`, which is what gives it a tab.
 */
export function useSummaryParam() {
  const { summary } = workspaceRoute.useSearch()
  return { summaryId: summary ?? null }
}

export function useChatSessionParam() {
  const { chatSession } = workspaceRoute.useSearch()
  return { chatSessionId: chatSession ?? null }
}

export function useTagRunParam() {
  const { tagRun } = workspaceRoute.useSearch()
  return { tagRunId: tagRun ?? null }
}

export function useDiscoverReportParam() {
  const { report } = workspaceRoute.useSearch()
  return { reportId: report ?? null }
}
