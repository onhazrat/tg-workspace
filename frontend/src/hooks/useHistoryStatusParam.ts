import { getRouteApi } from "@tanstack/react-router"
import { useCallback } from "react"
import type { ArtifactStatusFilter } from "@/types"

const workspaceRoute = getRouteApi("/_tg/workspace")

/** History's status filter, read from and written to `?historyStatus=`. */
export function useHistoryStatusParam(): {
  status: ArtifactStatusFilter | null
  setStatus: (next: ArtifactStatusFilter | null) => void
} {
  const { historyStatus } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const setStatus = useCallback(
    (next: ArtifactStatusFilter | null) => {
      navigate({
        search: (prev) => ({ ...prev, historyStatus: next ?? undefined }),
        replace: true,
      })
    },
    [navigate],
  )
  return { status: historyStatus ?? null, setStatus }
}
