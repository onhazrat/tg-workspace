import { useMemo, useState } from "react"
import {
  BoundHistogram,
  type Distribution,
  nice,
} from "@/components/filter-tree/BarHistogram"
import { BoundFields } from "@/components/filter-tree/BoundFields"
import { type Range, useZoomState } from "@/components/SpreadZoom"
import { TgButton } from "@/components/ui/tg-button"
import {
  type BoundKind,
  boundKind,
  inBound,
  type MetricBound,
  type MetricData,
  type MetricKey,
  metric,
  parseBound,
} from "@/lib/channels/channel-metrics"

export const BINS = 32

const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)]

/**
 * 32 bars from the lowest value to the highest. Counts such as subscribers
 * span orders of magnitude, so past two of them the axis is logarithmic, or
 * nearly every Channel would land in the first bar. A range starting at 0 is
 * measured from 1 and drawn on log(1 + x), since log 0 has no place. A zoom
 * `range` bins only the values in it, on the whole spread's scale (TB-04).
 */
export function histogram(
  values: number[],
  range?: Range | null,
): Distribution {
  const lo = values[0]
  const hi = values[values.length - 1]
  const log = lo >= 0 && hi / (lo > 0 ? lo : 1) > 100
  const [a, b] = range ?? [lo, hi]
  const identity = (x: number) => x
  const f = !log ? identity : a > 0 ? Math.log : Math.log1p
  const inv = !log ? identity : a > 0 ? Math.exp : Math.expm1
  const span = f(b) - f(a)
  const edge = (i: number) => inv(f(a) + (span * i) / BINS)
  const bins = new Array<number>(BINS).fill(0)
  for (const v of values) {
    if (v < a || v > b) continue
    const i = span === 0 ? 0 : Math.floor(((f(v) - f(a)) / span) * BINS)
    bins[Math.min(BINS - 1, i)]++
  }
  return { lo, hi, log, edge, bins, median: median(values) }
}

/**
 * One number criterion's editor (CTB-02): a histogram of the Account's
 * Channels that a drag across sets the bound from, the operator, one or two
 * fields, and how many Channels the bound keeps before it is added.
 */
export function ChannelMetricEditor({
  metricKey,
  data,
  initial,
  onSubmit,
  onBack,
}: {
  metricKey: MetricKey
  data: MetricData
  /** The Condition being changed; without one the editor adds. */
  initial?: MetricBound
  onSubmit: (bound: MetricBound) => void
  onBack?: () => void
}) {
  const m = metric(metricKey)
  const values = useMemo(() => data.values(metricKey), [data, metricKey])
  const [op, setOp] = useState<BoundKind>(boundKind(initial))
  const [a, setA] = useState(() => {
    const start = op === "lte" ? initial?.max : initial?.min
    return String(start ?? (values.length ? nice(median(values)) : ""))
  })
  const [b, setB] = useState(String(initial?.max ?? ""))
  const bound = parseBound(op, a, b)
  const zoom = useZoomState()
  const kept = !bound
    ? 0
    : bound.none
      ? data.total - values.length
      : values.filter((v) => inBound(v, bound)).length
  const select = (next: MetricBound) => {
    setOp(boundKind(next))
    setA(String(next.min ?? next.max))
    setB(String(next.max ?? ""))
  }
  return (
    <form
      className="space-y-2 p-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (bound) onSubmit(bound)
      }}
    >
      <div className="flex items-center gap-2 text-xs font-semibold">
        {onBack && (
          <button
            type="button"
            aria-label="Back to the criteria"
            onClick={onBack}
            className="text-app-ink/50 hover:text-app-ink"
          >
            ←
          </button>
        )}
        {m.label}
        {m.unit && (
          <span className="font-normal text-app-ink/50">{m.unit}</span>
        )}
      </div>
      {values.length > 0 ? (
        <BoundHistogram
          distribution={histogram(values, zoom.range)}
          bound={bound}
          noun="channels"
          onSelect={select}
          zoom={zoom}
        />
      ) : (
        <p className="text-[11px] text-app-ink/50">
          None of your channels has a value yet.
        </p>
      )}
      <BoundFields op={op} setOp={setOp} a={a} setA={setA} b={b} setB={setB} />
      <p className="text-[11px] text-app-ink/50">
        A channel with no {m.label.toLowerCase()} does not match a bound.
        {op === "none"
          ? " No value finds exactly those channels, and NOT on it the ones that have one."
          : " Choose no value to find them."}
      </p>
      <TgButton
        type="submit"
        size="sm"
        disabled={!bound}
        data-testid="metric-editor-submit"
        className="w-full"
      >
        {initial ? "Update" : "Add"} ·{" "}
        {op === "none"
          ? `${kept} with no value`
          : `${kept} of ${values.length} measured`}
      </TgButton>
    </form>
  )
}
