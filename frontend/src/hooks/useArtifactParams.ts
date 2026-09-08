import { getRouteApi } from "@tanstack/react-router"

const workspaceRoute = getRouteApi("/_tg/workspace")

/**
 * Which summary, chat session or tag run is open, held in the URL.
 *
 * The sibling of `useDiscoverReportParam`, and it exists because writing a
 * param nothing reads is worse than not writing one: History's open-artifact
 * navigation set `?summary=`, `?chatSession=` and `?tagRun=` while the views
 * still resolved their selection from context state, so clicking a row switched
 * tab and scope and then showed an empty view.
 *
 * `null` means nothing is open — which is a real state now that the feature
 * tabs render results only and no longer auto-open the most recent artifact.
 */
export function useSummaryParam() {
  const { summary } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()

  const openSummary = (id: string | null) => {
    navigate({
      search: (prev) => ({ ...prev, summary: id ?? undefined }),
      replace: true,
    })
  }

  return { summaryId: summary ?? null, openSummary }
}

export function useChatSessionParam() {
  const { chatSession } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()

  const openChatSession = (id: string | null) => {
    navigate({
      search: (prev) => ({ ...prev, chatSession: id ?? undefined }),
      replace: true,
    })
  }

  return { chatSessionId: chatSession ?? null, openChatSession }
}

export function useTagRunParam() {
  const { tagRun } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()

  const openTagRun = (id: string | null) => {
    navigate({
      search: (prev) => ({ ...prev, tagRun: id ?? undefined }),
      replace: true,
    })
  }

  return { tagRunId: tagRun ?? null, openTagRun }
}
