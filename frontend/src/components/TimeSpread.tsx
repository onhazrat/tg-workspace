/**
 * A moment's Spread drawn by the server (Directory moments, Logs, History):
 * the one Spread over its bins, a range zoom that reads once a pan settles,
 * and a pick as a Fixed Time bound out to whole minutes.
 */
import { dateText, Spread, type SpreadData } from "@/components/Spread"
import {
  SETTLE_MS,
  useRangeZoomKit,
  type ZoomState,
} from "@/components/SpreadZoom"
import { pickTimeBound, type TimeBound } from "@/lib/time-bound/bound"

export function TimeSpread({
  spread,
  zoom,
  selected,
  onPick,
  noun = "channels",
  title,
}: {
  spread: SpreadData
  /** The range `spread` was read for; the caller keeps it (TB-04). */
  zoom: ZoomState
  /** The bound's ends as epoch ms, drawn solid; `null` for none. */
  selected: { min?: number; max?: number } | null
  onPick: (bound: TimeBound) => void
  noun?: string
  title: string
}) {
  const lo = spread.min ?? 0
  const hi = spread.max ?? 0
  const kit = useRangeZoomKit(
    zoom,
    { lo, hi, log: false, median: spread.median ?? lo, bound: selected },
    SETTLE_MS,
  )
  if (!spread.bins.length)
    return <p className="text-[11px] text-app-ink/50">Nothing to spread.</p>
  return (
    <Spread
      bars={spread.bins}
      whole={[lo, hi]}
      shown={zoom.range ?? [lo, hi]}
      median={spread.median ?? undefined}
      selected={selected}
      onPick={(p) => onPick(pickTimeBound(p, spread.bins))}
      format={dateText}
      noun={noun}
      zoom={kit}
      title={title}
    />
  )
}
