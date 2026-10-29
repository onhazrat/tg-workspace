/**
 * The Account's Tag uses on a tab (ADR-042, TGU-02), kept on the server so
 * every device shows one order. Reading is one call; recording is
 * fire-and-forget and never blocks the act it follows, and nothing records
 * while viewing as someone.
 */
import { useQuery } from "@tanstack/react-query"
import { useCallback } from "react"
import { dataReadTagOrder, dataRecordTagUse } from "@/client"
import { queryClient } from "@/lib/queryClient"
import { viewAsClaims } from "@/lib/storage/scoped"
import type { TagTab } from "@/lib/tags/tag-use"
import { queryKeys } from "./queryKeys"

/** Each Tag's Tag use score on `tab`, by name in any case; 0 for none. */
export function useTagUses(tab: TagTab): (name: string) => number {
  const order = useQuery({
    queryKey: queryKeys.tagOrder(tab),
    queryFn: () => dataReadTagOrder({ body: { tab, scope: null } }),
    select: (rows) =>
      new Map(rows.map((row) => [row.name.toLowerCase(), row.score])),
  })
  const scores = order.data
  return useCallback(
    (name: string) => scores?.get(name.toLowerCase()) ?? 0,
    [scores],
  )
}

/** Record one use of each of `names` on `tab`. */
export function recordTagUse(tab: TagTab, ...names: string[]) {
  if (viewAsClaims() !== null) return
  for (const name of names)
    void dataRecordTagUse({ body: { tab, name } })
      .then(() =>
        queryClient.invalidateQueries({ queryKey: queryKeys.tagOrder(tab) }),
      )
      .catch(() => {})
}
