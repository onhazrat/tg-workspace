import {
  keepPreviousData,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query"
import { useEffect, useRef } from "react"

import { dataWindowCheck } from "@/client"
import { useScope } from "@/contexts/ScopeContext"
import { queryKeys } from "@/hooks/queryKeys"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
import { merged, onChannelChanges, touched } from "@/lib/complete-window/live"
import type { WindowCheck } from "@/lib/complete-window/window-check"
import { toWireWindow, type WindowState } from "@/lib/scope/window"

/** Edits settle first: dragging the window must not queue a check per step. */
const SETTLE_MS = 500

/**
 * The live check for these Channels and the current window (CW-01). It reads
 * data, never syncs.
 *
 * `updating` is true while the answer shown is for another selection or
 * window, so it can be dimmed: an edit, never a Live window's minute rolling,
 * which asks again but leaves the answer standing for the same Channels and
 * span.
 *
 * Live while mounted (WR-02): a sync that changes one of these Channels has
 * its verdicts asked again and merged about a second later, and a reconnect
 * asks the whole check again.
 */
export function useWindowCheck(names: readonly string[]) {
  const { windowKey, liveTick } = useScope()
  const shape = JSON.stringify([[...names].sort(), windowKey])
  const settled = useDebouncedValue(shape, SETTLE_MS)
  const [sorted, window] = JSON.parse(settled) as [string[], WindowState]
  const queryClient = useQueryClient()
  const key = queryKeys.windowCheck(sorted, window, liveTick)
  const query = useQuery({
    queryKey: key,
    queryFn: () =>
      dataWindowCheck({
        body: { channelNames: sorted, window: toWireWindow(window) },
      }),
    enabled: sorted.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
  useEffect(() => {
    if (!sorted.length) return
    return onChannelChanges(async (change) => {
      if (change === "all")
        return queryClient.invalidateQueries({ queryKey: key })
      const channelNames = touched(change, sorted)
      const cached = queryClient.getQueryData<WindowCheck>(key)
      if (!channelNames.length || !cached) return
      // At the cached answer's moment, so every row reads the same window.
      const fresh = await dataWindowCheck({
        body: {
          channelNames,
          window: toWireWindow(window),
          frozenAt: cached.frozenAt,
        },
      }).catch(() => undefined)
      if (fresh)
        queryClient.setQueryData<WindowCheck>(
          key,
          (old) => old && merged(old, fresh),
        )
    })
  }, [queryClient, settled, liveTick])
  const shown = useRef<string | null>(null)
  if (query.data && !query.isPlaceholderData) shown.current = settled
  return { ...query, updating: !!query.data && shown.current !== shape }
}
