import { getRouteApi } from "@tanstack/react-router"

const workspaceRoute = getRouteApi("/_tg/workspace")

/**
 * Which saved Discover report is open, held in the URL.
 *
 * Mirrors `useWorkspaceTab`: the Discover tab's selection lives in `?report=`
 * rather than component state, so History can deep-link a report and reopening
 * one survives a reload. `null` means "show the most recent report".
 */
export function useDiscoverReportParam() {
  const { report } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()

  const openReport = (id: string | null) => {
    navigate({
      search: (prev) => ({ ...prev, report: id ?? undefined }),
      replace: true,
    })
  }

  return { reportId: report ?? null, openReport }
}
