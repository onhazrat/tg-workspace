/**
 * When a log's entries were logged (TB-05), drawn in the Logged popover so
 * the Account can see when failures clustered. The server bins the whole
 * log under the text search, without the Logged bound, as a Directory
 * moment's spread is drawn without its own bound; zoom asks it for a range.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { LogSearch, LogType } from "@/api/data"
import { dataGetLogSpreadRoute, type LogSpreadResponse } from "@/client"
import { Spread } from "@/components/directory/DirectoryBoundEditor"
import { dateText } from "@/components/directory/DirectoryTimeEditor"
import { useZoomState, type ZoomState } from "@/components/SpreadZoom"
import { queryKeys } from "@/hooks/queryKeys"
import { floorToMinute, serverNow } from "@/lib/analysis-window"
import {
  barBound,
  resolveTimeBound,
  type TimeBound,
} from "@/lib/time-bound/bound"

export function LoggedSpreadView({
  spread,
  bound,
  zoom,
  onPick,
}: {
  spread?: LogSpreadResponse
  bound: TimeBound
  zoom: ZoomState
  onPick: (bound: TimeBound) => void
}) {
  if (!spread)
    return <p className="text-[11px] text-app-ink/50">Loading the spread…</p>
  const { start, end } = resolveTimeBound(bound, floorToMinute(serverNow()))
  const shown = start !== undefined || end !== undefined
  return (
    <Spread
      spread={spread}
      bound={
        shown
          ? {
              ...(start !== undefined && { min: start }),
              ...(end !== undefined && { max: end }),
            }
          : null
      }
      onBar={(bin) => onPick(barBound(bin, bin === spread.bins.at(-1)))}
      format={dateText}
      zoom={zoom}
      noun="entries"
    />
  )
}

/** The spread of one log, its zoom reset each time the popover opens. */
export function LoggedSpread({
  type,
  search,
  bound,
  onPick,
}: {
  type: LogType
  search: LogSearch
  bound: TimeBound
  onPick: (bound: TimeBound) => void
}) {
  const zoom = useZoomState()
  const [lo, hi] = zoom.range ?? []
  const query = {
    ...(search.query && { search: search.query }),
    ...(search.inDetails && { searchInDetails: true }),
    ...(zoom.range && { lo, hi }),
  }
  // Under the log's own key, so a write that invalidates the list redraws it.
  const spread = useQuery({
    queryKey: [...queryKeys.logs[type], "spread", query],
    queryFn: () => dataGetLogSpreadRoute({ path: { log_type: type }, query }),
    placeholderData: keepPreviousData,
  })
  return (
    <LoggedSpreadView
      spread={spread.data}
      bound={bound}
      zoom={zoom}
      onPick={onPick}
    />
  )
}
