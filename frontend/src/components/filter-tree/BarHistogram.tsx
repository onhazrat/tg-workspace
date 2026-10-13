import { type ReactNode, useState } from "react"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import { formatCount } from "@/lib/format-count"

/** A run of bars a drag covered, in the order the drag went. */
export type Run = { from: number; to: number }

/** Two significant figures, so a dragged edge reads 1,200 and not 1,187.43. */
export const nice = (v: number) => Number(v.toPrecision(2))

/**
 * Bars a drag selects a run from, with the hovered bar's story in the
 * caption. The Channels tab's number editors and the Posts tab's draw it, so
 * both look and drag alike; what a bar means, which bars are solid and what a
 * run selects are the caller's.
 */
export function BarHistogram({
  bins,
  solid,
  onSelect,
  caption,
  testId = "metric",
}: {
  bins: number[]
  /** Whether bar `i` is inside the selection, while nobody drags. */
  solid: (i: number) => boolean
  onSelect: (run: Run) => void
  /** The caption's left, middle and right; `shown` is the bar under the pointer. */
  caption: (shown: number | null) => [ReactNode, ReactNode, ReactNode]
  /** Prefixes the bars' and caption's test ids, for two charts on one screen. */
  testId?: string
}) {
  const [drag, setDrag] = useState<Run | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const peak = Math.max(...bins)
  const end = () => {
    if (drag) onSelect(drag)
    setDrag(null)
  }
  const isSolid = (i: number) =>
    drag
      ? i >= Math.min(drag.from, drag.to) && i <= Math.max(drag.from, drag.to)
      : solid(i)
  const shown = drag ? drag.to : hover
  const [left, middle, right] = caption(shown)
  return (
    <div className="space-y-1">
      <div
        role="presentation"
        className="flex h-16 cursor-crosshair touch-none select-none items-end gap-px rounded-md bg-app-ink/[0.03] px-0.5"
        onPointerUp={end}
        onPointerLeave={() => {
          setHover(null)
          end()
        }}
      >
        {bins.map((n, i) => (
          <div
            key={i}
            data-testid={`${testId}-bar-${i}`}
            data-solid={isSolid(i)}
            className={`flex-1 rounded-t-[2px] ${isSolid(i) ? "bg-app-ink/70" : "bg-app-ink/15"} ${shown === i ? "ring-1 ring-app-ink/60" : ""}`}
            style={{
              height: `${n === 0 ? 2 : Math.max(8, (n / peak) * 100)}%`,
            }}
            onPointerDown={(e) => {
              // A touch captures the pointer to the first bar, which would
              // keep every other bar from hearing the drag.
              if (e.currentTarget.hasPointerCapture?.(e.pointerId))
                e.currentTarget.releasePointerCapture(e.pointerId)
              setDrag({ from: i, to: i })
            }}
            onPointerEnter={() => {
              setHover(i)
              if (drag) setDrag({ ...drag, to: i })
            }}
          />
        ))}
      </div>
      <div
        data-testid={`${testId}-histogram-caption`}
        className="flex justify-between gap-2 text-[10px] tabular-nums text-app-ink/50"
      >
        <span>{left}</span>
        <span className="text-center">{middle}</span>
        <span>{right}</span>
      </div>
    </div>
  )
}

/** A measure's bars: built in the browser (Channels) or read from the server (Posts). */
export type Distribution = {
  bins: number[]
  /** The value bar `i` starts at; `edge(bins.length)` is the highest. */
  edge: (i: number) => number
  lo: number
  hi: number
  median: number
  log: boolean
}

/**
 * A run of bars as a bound: touching the first bar leaves the low end open
 * ("at most"), touching the last the high end ("at least"), both is every
 * measured value.
 */
function runBound(run: Run, d: Distribution): MetricBound {
  const s = Math.min(run.from, run.to)
  const t = Math.max(run.from, run.to)
  const min = s === 0 ? undefined : nice(d.edge(s))
  const max = t === d.bins.length - 1 ? undefined : nice(d.edge(t + 1))
  if (min === undefined && max === undefined) return { min: d.lo }
  return { min, max }
}

/**
 * A number filter's histogram: the bars `bound` keeps are solid, a drag sets
 * the bound, and the caption names the median or the hovered bar's count and
 * range.
 */
export function BoundHistogram({
  distribution: d,
  bound,
  noun,
  onSelect,
}: {
  distribution: Distribution
  bound: MetricBound | null
  /** What a bar counts, plural: "channels", "posts". */
  noun: string
  onSelect: (bound: MetricBound) => void
}) {
  return (
    <BarHistogram
      bins={d.bins}
      solid={(i) =>
        !!bound &&
        !bound.none &&
        (bound.min === undefined || d.edge(i + 1) > bound.min) &&
        (bound.max === undefined || d.edge(i) <= bound.max)
      }
      onSelect={(run) => onSelect(runBound(run, d))}
      caption={(shown) => [
        formatCount(d.lo),
        shown !== null
          ? `${d.bins[shown]} ${noun}, ${formatCount(nice(d.edge(shown)))}–${formatCount(nice(d.edge(shown + 1)))}`
          : `median ${formatCount(d.median)}${d.log ? ", log scale" : ""}`,
        formatCount(d.hi),
      ]}
    />
  )
}
