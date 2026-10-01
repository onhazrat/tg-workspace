import { getRouteApi } from "@tanstack/react-router"
import { useCallback, useMemo } from "react"
import {
  emptyPostFilter,
  type PostFilter,
  parsePostFilter,
  printPostFilter,
} from "@/lib/posts/post-filter"

const workspaceRoute = getRouteApi("/_tg/workspace")

/**
 * The Post filter, read from and written to `?postFilter=` (PTR-03), so a
 * reload keeps it and a link shares it. A string that does not parse is
 * ignored, as the Channel filter's is.
 */
export function usePostFilterParam(): {
  postFilter: PostFilter
  setPostFilter: (next: PostFilter) => void
} {
  const { postFilter: text } = workspaceRoute.useSearch()
  const navigate = workspaceRoute.useNavigate()
  const postFilter = useMemo(
    () => (text ? parsePostFilter(text) : null) ?? emptyPostFilter(),
    [text],
  )
  const setPostFilter = useCallback(
    (next: PostFilter) => {
      const printed = printPostFilter(next)
      navigate({
        search: (prev) => ({ ...prev, postFilter: printed || undefined }),
        replace: true,
      })
    },
    [navigate],
  )
  return { postFilter, setPostFilter }
}
