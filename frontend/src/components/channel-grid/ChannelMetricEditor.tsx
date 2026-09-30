import { useMemo, useState } from "react"
import { TgButton } from "@/components/ui/tg-button"
import {
  inBound,
  type MetricBound,
  type MetricKey,
  metric,
} from "@/lib/channels/channel-metrics"
import { formatCount } from "@/lib/format-count"

/** What an editor needs of the Account's Channels. */
export type MetricData = {
  /** A metric's measured values across the Account's Channels, ascending. */
  values: (key: MetricKey) => number[]
  /** Every Channel, measured or not. */
  total: number
}

const BINS = 32

/** Two significant figures, so a dragged edge reads 1,200 and not 1,187.43. */
const nice = (v: number) => Number(v.toPrecision(2))

const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)]

/**
 * 32 bars from the lowest value to the highest. Counts such as subscribers
 * span orders of magnitude, so past two of them the axis is logarithmic, or
 * nearly every Channel would land in the first bar.
 */
function histogram(values: number[]) {
  const lo = values[0]
  const hi = values[values.length - 1]
  const log = lo >= 0 && hi / Math.max(lo, 1) > 100
  const f = log ? Math.log1p : (x: number) => x
  const inv = log ? Math.expm1 : (x: number) => x
  const span = f(hi) - f(lo)
  const edge = (i: number) => inv(f(lo) + (span * i) / BINS)
  const bins = new Array<number>(BINS).fill(0)
  for (const v of values) {
    const i = span === 0 ? 0 : Math.floor(((f(v) - f(lo)) / span) * BINS)
    bins[Math.min(BINS - 1, i)]++
  }
  return { lo, hi, log, edge, bins, peak: Math.max(...bins) }
}

type Run = { from: number; to: number }

/**
 * A run of bars as a bound: touching the first bar leaves the low end open
 * ("at most"), touching the last the high end ("at least"), both is every
 * measured Channel.
 */
function runBound(run: Run, h: ReturnType<typeof histogram>): MetricBound {
  const s = Math.min(run.from, run.to)
  const t = Math.max(run.from, run.to)
  const min = s === 0 ? undefined : nice(h.edge(s))
  const max = t === BINS - 1 ? undefined : nice(h.edge(t + 1))
  if (min === undefined && max === undefined) return { min: h.lo }
  return { min, max }
}

function Histogram({
  values,
  bound,
  onSelect,
}: {
  values: number[]
  bound: MetricBound | null
  onSelect: (bound: MetricBound) => void
}) {
  const [drag, setDrag] = useState<Run | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const h = histogram(values)
  const end = () => {
    if (drag) onSelect(runBound(drag, h))
    setDrag(null)
  }
  const solid = (i: number) =>
    drag
      ? i >= Math.min(drag.from, drag.to) && i <= Math.max(drag.from, drag.to)
      : !!bound &&
        !bound.none &&
        (bound.min === undefined || h.edge(i + 1) > bound.min) &&
        (bound.max === undefined || h.edge(i) <= bound.max)
  const shown = drag ? drag.to : hover
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
        {h.bins.map((n, i) => (
          <div
            key={i}
            data-testid={`metric-bar-${i}`}
            data-solid={solid(i)}
            className={`flex-1 rounded-t-[2px] ${solid(i) ? "bg-app-ink/70" : "bg-app-ink/15"} ${shown === i ? "ring-1 ring-app-ink/60" : ""}`}
            style={{
              height: `${n === 0 ? 2 : Math.max(8, (n / h.peak) * 100)}%`,
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
        data-testid="metric-histogram-caption"
        className="flex justify-between gap-2 text-[10px] tabular-nums text-app-ink/50"
      >
        <span>{formatCount(h.lo)}</span>
        <span className="text-center">
          {shown !== null
            ? `${h.bins[shown]} channels, ${formatCount(nice(h.edge(shown)))}–${formatCount(nice(h.edge(shown + 1)))}`
            : `median ${formatCount(median(values))}${h.log ? ", log scale" : ""}`}
        </span>
        <span>{formatCount(h.hi)}</span>
      </div>
    </div>
  )
}

type Op = "gte" | "lte" | "between" | "none"

const OPS: [Op, string][] = [
  ["gte", "at least"],
  ["lte", "at most"],
  ["between", "between"],
  ["none", "no value"],
]

const opOf = (b?: MetricBound): Op =>
  b?.none
    ? "none"
    : b?.min !== undefined && b.max !== undefined
      ? "between"
      : b?.max !== undefined
        ? "lte"
        : "gte"

const num = (text: string) =>
  text.trim() === "" || !Number.isFinite(Number(text))
    ? undefined
    : Number(text)

/** The bound the fields spell, or null while it is incomplete. */
function boundOf(op: Op, a: string, b: string): MetricBound | null {
  const [x, y] = [num(a), num(b)]
  if (op === "none") return { none: true }
  if (x === undefined) return null
  if (op === "gte") return { min: x }
  if (op === "lte") return { max: x }
  return y === undefined || y < x ? null : { min: x, max: y }
}

const fieldClass =
  "h-8 min-w-0 flex-1 rounded-md border border-app-ink/15 bg-app-muted px-2 text-xs tabular-nums outline-none focus:border-app-ink/40"

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
  const [op, setOp] = useState<Op>(opOf(initial))
  const [a, setA] = useState(() => {
    const start = op === "lte" ? initial?.max : initial?.min
    return String(start ?? (values.length ? nice(median(values)) : ""))
  })
  const [b, setB] = useState(String(initial?.max ?? ""))
  const bound = boundOf(op, a, b)
  const kept = !bound
    ? 0
    : bound.none
      ? data.total - values.length
      : values.filter((v) => inBound(v, bound)).length
  const select = (next: MetricBound) => {
    setOp(opOf(next))
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
        <Histogram values={values} bound={bound} onSelect={select} />
      ) : (
        <p className="text-[11px] text-app-ink/50">
          None of your channels has a value yet.
        </p>
      )}
      <fieldset aria-label="Operator" className="m-0 flex gap-1 border-0 p-0">
        {OPS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            aria-pressed={op === key}
            onClick={() => setOp(key)}
            className={`flex-1 rounded-md border px-1.5 py-1 text-[11px] font-semibold ${
              op === key
                ? "border-app-ink bg-app-ink text-app-bg"
                : "border-app-ink/15 hover:border-app-ink/40"
            }`}
          >
            {label}
          </button>
        ))}
      </fieldset>
      {op !== "none" && (
        <div className="flex items-center gap-1.5">
          <input
            type="number"
            step="any"
            aria-label={op === "between" ? "From" : "Value"}
            value={a}
            onChange={(e) => setA(e.target.value)}
            className={fieldClass}
          />
          {op === "between" && (
            <>
              <span className="text-app-ink/50">and</span>
              <input
                type="number"
                step="any"
                aria-label="To"
                value={b}
                onChange={(e) => setB(e.target.value)}
                className={fieldClass}
              />
            </>
          )}
        </div>
      )}
      <p className="text-[11px] text-app-ink/50">
        A channel with no {m.label.toLowerCase()} does not match a bound.
        {op === "none"
          ? " No value finds exactly those channels."
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
