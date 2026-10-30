import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useRef } from "react"

import { dataWindowCheck } from "@/client"
import { useScope } from "@/contexts/ScopeContext"
import { queryKeys } from "@/hooks/queryKeys"
import { useDebouncedValue } from "@/hooks/useDebouncedValue"
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
 */
export function useWindowCheck(names: readonly string[]) {
  const { windowKey, liveTick } = useScope()
  const shape = JSON.stringify([[...names].sort(), windowKey])
  const settled = useDebouncedValue(shape, SETTLE_MS)
  const [sorted, window] = JSON.parse(settled) as [string[], WindowState]
  const query = useQuery({
    queryKey: queryKeys.windowCheck(sorted, window, liveTick),
    queryFn: () =>
      dataWindowCheck({
        body: { channelNames: sorted, window: toWireWindow(window) },
      }),
    enabled: sorted.length > 0,
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  })
  const shown = useRef<string | null>(null)
  if (query.data && !query.isPlaceholderData) shown.current = settled
  return { ...query, updating: !!query.data && shown.current !== shape }
}
