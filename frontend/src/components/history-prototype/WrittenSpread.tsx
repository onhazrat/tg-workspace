// PROTOTYPE: when Artifacts were Written, drawn in the Written popover as
// the Logs tab draws its Logged spread (TB-05). Served by
// backend/scripts/proto_history_api.py. Never merge as is.
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { request } from "@/api/base"
import type { LogSpreadResponse } from "@/client"
import { dateText, Spread } from "@/components/Spread"
import { useZoomState } from "@/components/SpreadZoom"
import { floorToMinute, serverNow } from "@/lib/analysis-window"
import {
  barBound,
  resolveTimeBound,
  type TimeBound,
} from "@/lib/time-bound/bound"
import type { HistoryBarState } from "./FilterBar"

/** Under every History filter but the time, so the bound shows what lies around it. */
export function WrittenSpread({
  state,
  onPick,
}: {
  state: HistoryBarState
  onPick: (bound: TimeBound) => void
}) {
  const zoom = useZoomState()
  const qs = new URLSearchParams()
  if (state.kind) qs.set("kind", state.kind)
  if (state.search.trim()) qs.set("search", state.search.trim())
  if (state.starred) qs.set("starred", "true")
  if (state.status) qs.set("status", state.status)
  qs.set("moment", state.moment)
  if (zoom.range) {
    qs.set("lo", String(zoom.range[0]))
    qs.set("hi", String(zoom.range[1]))
  }
  const q = qs.toString()
  const spread = useQuery({
    queryKey: ["artifacts", "spread", q],
    queryFn: () =>
      request<LogSpreadResponse>(
        `/api/v1/data/artifacts/spread${q ? `?${q}` : ""}`,
      ),
    placeholderData: keepPreviousData,
  })
  if (!spread.data)
    return <p className="text-[11px] text-app-ink/50">Loading the spread…</p>
  const data = spread.data
  const { start, end } = resolveTimeBound(
    state.written,
    floorToMinute(serverNow()),
  )
  return (
    <Spread
      spread={data}
      bound={
        start !== undefined || end !== undefined
          ? {
              ...(start !== undefined && { min: start }),
              ...(end !== undefined && { max: end }),
            }
          : null
      }
      onBar={(bin) => onPick(barBound(bin, bin === data.bins.at(-1)))}
      format={dateText}
      zoom={zoom}
      noun={state.moment === "written" ? "artifacts" : "window starts"}
    />
  )
}
