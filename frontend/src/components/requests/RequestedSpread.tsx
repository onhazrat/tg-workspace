/**
 * The Requested range picker's spread (RQS-09): when Requests were made, over
 * everything kept, drawn in the time bound's popover on the one Spread, with
 * the 7-day and 30-day edges marked over the bars. The bars are binned in the
 * browser, so zoom and panning never read again.
 */
import type { RequestSpreadResponse } from "@/client"
import { dateText, Spread } from "@/components/Spread"
import { useRangeZoomKit, useZoomState } from "@/components/SpreadZoom"
import { floorToMinute, serverNow } from "@/lib/analysis-window"
import { requestedSpread, tierEdges } from "@/lib/requests/spread"
import {
  pickedBound,
  spreadSelection,
  type TimeBound,
  timeBoundSummary,
} from "@/lib/time-bound/bound"

export function RequestedSpread({
  spread,
  bound,
  onPick,
  now = floorToMinute(serverNow()),
}: {
  spread?: RequestSpreadResponse
  bound: TimeBound
  onPick: (bound: TimeBound) => void
  /** The server's minute: where the tier edges are measured from. */
  now?: number
}) {
  const zoom = useZoomState()
  const shown = spread && requestedSpread(spread.buckets, zoom.range)
  const selected = spreadSelection(bound, now)
  const kit = useRangeZoomKit(zoom, {
    lo: shown?.min ?? 0,
    hi: shown?.max ?? 0,
    log: false,
    median: shown?.median ?? 0,
    bound: selected,
  })
  if (!spread)
    return <p className="text-[11px] text-app-ink/50">Loading the spread…</p>
  if (!shown)
    return <p className="text-[11px] text-app-ink/50">No Requests to spread.</p>
  const { bins } = shown
  return (
    <Spread
      testId="requests-spread"
      bars={bins}
      whole={[shown.min, shown.max]}
      shown={zoom.range ?? [shown.min, shown.max]}
      median={shown.median}
      selected={selected}
      onPick={(p) =>
        onPick(pickedBound(p, bins[p.run.from].lo, bins[p.run.to].hi))
      }
      format={dateText}
      noun="Requests"
      zoom={kit}
      marks={tierEdges(
        now,
        spread.recordDays,
        spread.hourlyDays,
        bins[0].lo,
        bins[bins.length - 1].hi,
      )}
      title="When the Requests were made"
      description={`${timeBoundSummary(bound, now)}.`}
    />
  )
}
