/**
 * A number's Spread in a Number bound editor (ADR-037): the one Spread over
 * bars binned in the browser or read from the server, a range zoom, and a
 * pick as a Number bound, its edges rounded to two figures.
 */
import { Spread } from "@/components/Spread"
import { useRangeZoomKit, type ZoomState } from "@/components/SpreadZoom"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import { formatCount } from "@/lib/format-count"
import { pickBound, type SpreadBar } from "@/lib/spread"

/** A number's bars, and the whole spread's ends, median and scale. */
export type NumberBars = {
  bars: SpreadBar[]
  lo: number
  hi: number
  median: number
  log: boolean
}

export function NumberSpread({
  bars: d,
  zoom,
  bound,
  onPick,
  noun,
  title,
  settle,
}: {
  bars: NumberBars
  /** The range the bars span, kept by whoever bins or reads them (TB-04). */
  zoom: ZoomState
  bound: MetricBound | null
  onPick: (bound: MetricBound) => void
  /** What a bar counts, plural: "channels", "posts". */
  noun: string
  title: string
  /** Wait this long after a pan before a server read; none when binned here. */
  settle?: number
}) {
  const selected = bound && !bound.none ? bound : null
  const kit = useRangeZoomKit(zoom, { ...d, bound }, settle)
  return (
    <Spread
      bars={d.bars}
      whole={[d.lo, d.hi]}
      shown={zoom.range ?? [d.lo, d.hi]}
      median={d.median}
      log={d.log}
      selected={selected}
      onPick={(p) => onPick(pickBound(p, d.lo))}
      format={formatCount}
      noun={noun}
      zoom={kit}
      title={title}
    />
  )
}
