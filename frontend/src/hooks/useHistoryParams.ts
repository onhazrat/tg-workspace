import { getRouteApi } from "@tanstack/react-router"
import { useCallback, useMemo } from "react"
import {
  type HistoryParams,
  historySearchPatch,
  readHistoryParams,
} from "@/lib/history/history-params"

const workspaceRoute = getRouteApi("/_tg/")

/**
 * History's filters, read from and written to the workspace URL, so a link
 * reopens the list it was copied from. The bar and the command palette both
 * go through this, so they never disagree.
 */
export function useHistoryParams(): {
  params: HistoryParams
  setParams: (patch: Partial<HistoryParams>) => void
} {
  const search = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const params = useMemo(() => readHistoryParams(search), [search])
  const setParams = useCallback(
    (patch: Partial<HistoryParams>) => {
      navigate({
        search: (prev) => ({ ...prev, ...historySearchPatch(patch) }),
        replace: true,
      })
    },
    [navigate],
  )
  return { params, setParams }
}
