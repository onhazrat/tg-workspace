// PROTOTYPE: a moment's Spread drawn by the server, on the one Spread
// (variant 1): Directory moments, Logs, History. Never merge.
import { dateText, type SpreadData } from "@/components/Spread"
import type { ZoomState } from "@/components/SpreadZoom"
import type { TimeBound } from "@/lib/time-bound/bound"
import { OneSpread, useRangeZoomKit } from "./OneSpread"
import { pickTimeBound } from "./time-pick"

export function TimeSpread({
  spread,
  zoom,
  selected,
  onPick,
  noun = "channels",
  title,
  debounce = 150,
}: {
  spread: SpreadData
  zoom: ZoomState
  selected: { min?: number; max?: number } | null
  onPick: (bound: TimeBound) => void
  noun?: string
  title: string
  debounce?: number
}) {
  const lo = spread.min ?? 0
  const hi = spread.max ?? 0
  const kit = useRangeZoomKit(
    zoom,
    { lo, hi, log: false, median: spread.median ?? lo, bound: selected },
    debounce,
  )
  if (!spread.bins.length)
    return <p className="text-[11px] text-app-ink/50">Nothing to spread.</p>
  const bars = spread.bins
  return (
    <OneSpread
      bars={bars}
      whole={[lo, hi]}
      shown={zoom.range ?? [lo, hi]}
      median={spread.median ?? undefined}
      selected={selected}
      onPick={(p) => onPick(pickTimeBound(p, bars))}
      format={dateText}
      noun={noun}
      zoom={kit}
      title={title}
    />
  )
}
