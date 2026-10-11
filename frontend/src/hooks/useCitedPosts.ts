import { useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { lookupPosts } from "@/lib/posts/store"
import { citedPostResolver } from "@/lib/summaries/cited-posts"
import { parseCitationRefs } from "@/lib/summaries/summary-model"
import type { Summary } from "@/types"
import { queryKeys } from "./queryKeys"

/**
 * A Summary's Cited Posts (SUMTAB-04): every Citation in its text looked up in
 * one batch, resolved live first and from the stored snapshot behind that,
 * against the frozen Scope's Post refs. The photo strip and the coverage wall
 * read the same resolver. Pass the Summary *detail*: the list row has neither
 * the snapshot nor the refs.
 */
export function useCitedPosts(
  summary: Pick<Summary, "text" | "citedPosts" | "scope"> | null | undefined,
  lookup: typeof lookupPosts = lookupPosts,
) {
  const text = summary?.text ?? ""
  const refs = useMemo(() => parseCitationRefs(text), [text])
  const { data: live, isPending } = useQuery({
    queryKey: queryKeys.citedPosts(refs),
    queryFn: () => lookup(refs),
    enabled: refs.length > 0,
    staleTime: 60_000,
  })
  const snapshot = summary?.citedPosts
  const covered = summary?.scope?.posts
  const resolve = useMemo(
    () => citedPostResolver({ live: live ?? [], snapshot, covered }),
    [live, snapshot, covered],
  )
  return { refs, resolve, loading: refs.length > 0 && isPending }
}
