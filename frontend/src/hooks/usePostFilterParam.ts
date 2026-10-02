import { getRouteApi } from "@tanstack/react-router"
import { useCallback, useMemo } from "react"
import { toast } from "sonner"
import {
  emptyPostFilter,
  POST_FILTER_BOUNDS,
  type PostFilter,
  parsePostFilter,
  printPostFilter,
  withinPostFilterBounds,
} from "@/lib/posts/post-filter"

const workspaceRoute = getRouteApi("/_tg/workspace")

/**
 * The Post filter, read from and written to `?postFilter=` (PTR-03), so a
 * reload keeps it and a link shares it. A string that does not parse is
 * ignored, as the Channel filter's is, and so is one past the server's bounds.
 * An edit that would cross them is refused with a toast rather than written,
 * or the filter would vanish on the next read of the URL.
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
      if (!withinPostFilterBounds(next)) {
        toast.error(
          `A Post filter holds at most ${POST_FILTER_BOUNDS.nodes} blocks, nested ${POST_FILTER_BOUNDS.depth} levels deep.`,
        )
        return
      }
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
