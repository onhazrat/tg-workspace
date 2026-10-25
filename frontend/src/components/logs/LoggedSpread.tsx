/**
 * When a log's entries were logged (TB-05), drawn in the Logged popover so
 * the Account can see when failures clustered. The server bins the whole
 * log under the text search, without the Logged bound, as a Directory
 * moment's spread is drawn without its own bound; zoom asks it for a range.
 */
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import type { LogSearch, LogType } from "@/api/data"
import { dataGetLogSpreadRoute, type LogSpreadResponse } from "@/client"
import { useZoomState, type ZoomState } from "@/components/SpreadZoom"
import { TimeSpread } from "@/components/TimeSpread"
import { queryKeys } from "@/hooks/queryKeys"
import { floorToMinute, serverNow } from "@/lib/analysis-window"
import { spreadSelection, type TimeBound } from "@/lib/time-bound/bound"

export function LoggedSpreadView({
  spread,
  bound,
  zoom,
  onPick,
  noun = "entries",
  title = "When the entries were logged",
}: {
  spread?: LogSpreadResponse
  bound: TimeBound
  zoom: ZoomState
  onPick: (bound: TimeBound) => void
  /** What a bar counts; History's spread counts artifacts. */
  noun?: string
  /** Full screen's heading. */
  title?: string
}) {
  if (!spread)
    return <p className="text-[11px] text-app-ink/50">Loading the spread…</p>
  return (
    <TimeSpread
      spread={spread}
      zoom={zoom}
      selected={spreadSelection(bound, floorToMinute(serverNow()))}
      onPick={onPick}
      noun={noun}
      title={title}
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
