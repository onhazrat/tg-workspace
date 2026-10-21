/**
 * A spread drawn as bars, shared by every bound editor that draws one: the
 * Directory's measures and moments, the Channels tab's moments and the Logs
 * tab's Logged bound. Zoom is `SpreadZoom.tsx` beside it.
 */
import type { DirectoryDistributionResponse } from "@/client"
import { SpreadZoomBar, type ZoomState } from "@/components/SpreadZoom"
import type { MetricBound } from "@/lib/channels/channel-metrics"
import { formatCount } from "@/lib/format-count"

/** Bars in a spread, as many as the server draws. */
export const BINS = 32

const DAY_MS = 86_400_000

/** A time spread's captions: dates, and the time of day once under three days show. */
export const dateText = (ms: number, shown = Number.POSITIVE_INFINITY) =>
  new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(shown < 3 * DAY_MS && { timeStyle: "short" }),
  }).format(ms)

export type Bin = DirectoryDistributionResponse["bins"][number]

/** What `Spread` draws: a Directory distribution, or any spread of bars (TB-05). */
export type SpreadData = Pick<
  DirectoryDistributionResponse,
  "bins" | "min" | "max" | "median"
> & { scale?: DirectoryDistributionResponse["scale"] }

/** Whether a bar overlaps the bound, so the bars show what it keeps. */
const inside = (bin: Bin, bound: MetricBound | null) =>
  !!bound &&
  !bound.none &&
  (bound.min === undefined || bin.hi > bound.min) &&
  (bound.max === undefined || bin.lo <= bound.max)

/**
 * A measure's spread as bars, a click on one choosing it. `format` writes a
 * value: a count by default, a moment's epoch ms as a date (DPF), told how
 * wide a span is shown. With a `zoom` the bars span its range (TB-04); the
 * median and scale stay the whole spread's. `noun` names what a bar counts.
 */
export function Spread({
  spread,
  bound,
  onBar,
  format = formatCount,
  zoom,
  noun = "channels",
}: {
  spread: SpreadData
  bound: MetricBound | null
  onBar: (bin: Bin) => void
  format?: (value: number, shown: number) => string
  zoom?: ZoomState
  noun?: string
}) {
  const peak = Math.max(1, ...spread.bins.map((bin) => bin.count))
  const [lo, hi] = [spread.min ?? 0, spread.max ?? 0]
  const [from, to] = zoom?.range ?? [lo, hi]
  const write = (value: number) => format(value, to - from)
  return (
    <div className="space-y-1">
      {zoom && (
        <SpreadZoomBar
          spreading={{
            lo,
            hi,
            log: spread.scale === "log",
            median: spread.median ?? lo,
            bound,
          }}
          zoom={zoom}
        />
      )}
      <div className="flex h-16 items-end gap-px rounded-md bg-app-ink/[0.03] px-0.5">
        {spread.bins.map((bin, i) => (
          <button
            key={bin.lo}
            type="button"
            data-testid={`directory-bound-bar-${i}`}
            title={`${write(bin.lo)}–${write(bin.hi)}: ${bin.count} ${noun}`}
            onClick={() => onBar(bin)}
            className={`flex-1 rounded-t-[2px] ${inside(bin, bound) ? "bg-app-ink/70" : "bg-app-ink/15 hover:bg-app-ink/40"}`}
            style={{
              height: `${bin.count === 0 ? 2 : Math.max(8, (bin.count / peak) * 100)}%`,
            }}
          />
        ))}
      </div>
      <div
        data-testid="spread-caption"
        className="flex justify-between gap-2 text-[10px] tabular-nums text-app-ink/50"
      >
        <span>{write(from)}</span>
        <span>
          median {write(spread.median ?? 0)}
          {spread.scale === "log" ? ", log scale" : ""}
        </span>
        <span>{write(to)}</span>
      </div>
    </div>
  )
}
