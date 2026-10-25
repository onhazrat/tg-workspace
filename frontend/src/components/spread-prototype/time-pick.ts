// PROTOTYPE: a run on a moment's Spread as a Time bound (variant 1). Never merge.
import { minuteBound, type TimeBound } from "@/lib/time-bound/bound"
import type { Pick, SpreadBar } from "./OneSpread"

/** Open ends dropped; both touched is everything with a value. */
function opened(b: TimeBound, p: Pick): TimeBound {
  if (p.all) return { mode: "fixed", start: b.start }
  return {
    mode: "fixed",
    ...(p.min !== undefined && { start: b.start }),
    ...(p.max !== undefined && { end: b.end }),
  }
}

/**
 * Over a server's bars, out to whole minutes. A bar counts `[lo, hi)` and
 * the last one `[lo, hi]`, as `barBound` reads one.
 */
export function pickTimeBound(p: Pick, bars: SpreadBar[]): TimeBound {
  const first = bars[p.run.from]
  const last = bars[p.run.to]
  const newest = p.run.to === bars.length - 1 ? last.hi : Math.ceil(last.hi) - 1
  return opened(minuteBound(first.lo, newest), p)
}

/** Over bars that keep their minutes, so the bound keeps exactly what they count. */
export function pickMinuteBound(
  p: Pick,
  minutes: number[][],
): TimeBound | null {
  const held = minutes.slice(p.run.from, p.run.to + 1).flat()
  if (!held.length) return null
  return opened(minuteBound(held[0], held[held.length - 1]), p)
}
