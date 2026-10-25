// PROTOTYPE: one Number bound editor for the Channel, Directory, Post and
// Requests filters (variant 1). Never merge.
import { type ReactNode, useMemo, useState } from "react"
import { histogram } from "@/components/channel-grid/ChannelMetricEditor"
import { BoundFields } from "@/components/filter-tree/BoundFields"
import { useZoomState, type ZoomState } from "@/components/SpreadZoom"
import { TgButton } from "@/components/ui/tg-button"
import {
  type BoundKind,
  boundKind,
  inBound,
  type MetricBound,
  parseBound,
} from "@/lib/channels/channel-metrics"
import { formatCount } from "@/lib/format-count"
import { wholeBound } from "@/lib/posts/post-filter"
import {
  nice,
  OneSpread,
  type Pick,
  type SpreadBar,
  useRangeZoomKit,
} from "./OneSpread"

/** Bars the server drew for one zoom, normalised. */
export type ReadBars = {
  bars: SpreadBar[]
  lo: number
  hi: number
  median: number
  log: boolean
  /** How many have no value, where the read says. */
  noValue?: number
}

/**
 * Where the numbers come from. Local values (sorted) the editor bins, zooms
 * and counts itself; or a read the caller makes for the zoom it is given,
 * with an optional count of what a bound keeps.
 */
export type NumberSource =
  | { kind: "values"; values: number[]; total?: number }
  | {
      kind: "read"
      /** `undefined` while loading, `null` when nothing has a value. */
      read: ReadBars | null | undefined
      zoom: ZoomState
      count?: (bound: MetricBound) => ReactNode
    }

const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)]

/** A run as a bound: an open end where it touched one, everything measured for both. */
const pickBound = (p: Pick, lo: number): MetricBound =>
  p.all
    ? { min: lo }
    : {
        ...(p.min !== undefined && { min: nice(p.min) }),
        ...(p.max !== undefined && { max: nice(p.max) }),
      }

export function NumberBoundEditor({
  label,
  unit,
  description,
  initial,
  source,
  min,
  whole = false,
  noValue = true,
  noun,
  onSubmit,
  onBack,
}: {
  label: ReactNode
  unit?: string
  description?: ReactNode
  /** The Condition being changed; without one the editor adds. */
  initial?: MetricBound
  source: NumberSource
  /** The lowest value a field takes, for a number that has a floor. */
  min?: number
  /** A whole number: the bound is rounded inward. */
  whole?: boolean
  /** Whether No value is offered; a count always has one. */
  noValue?: boolean
  /** What the bars count, plural: "channels", "posts". */
  noun: string
  onSubmit: (bound: MetricBound) => void
  onBack?: () => void
}) {
  const localZoom = useZoomState()
  const zoom = source.kind === "values" ? localZoom : source.zoom
  const local = source.kind === "values" ? source.values : null
  const drawn: ReadBars | null | undefined = useMemo(() => {
    if (source.kind === "read") return source.read
    if (!local?.length) return null
    const d = histogram(local, zoom.range)
    return {
      bars: d.bins.map((count, i) => ({
        lo: d.edge(i),
        hi: d.edge(i + 1),
        count,
      })),
      lo: d.lo,
      hi: d.hi,
      median: d.median,
      log: d.log,
    }
  }, [source, local, zoom.range])

  // The median prefills only when the bars are known as the editor opens.
  const [op, setOp] = useState<BoundKind>(boundKind(initial))
  const [a, setA] = useState(() => {
    const start = op === "lte" ? initial?.max : initial?.min
    return String(start ?? (local?.length ? nice(median(local)) : ""))
  })
  const [b, setB] = useState(String(initial?.max ?? ""))
  const typed = parseBound(op, a, b, { min })
  const bound = whole && typed ? wholeBound(typed) : typed

  const kit = useRangeZoomKit(
    zoom,
    {
      lo: drawn?.lo ?? 0,
      hi: drawn?.hi ?? 0,
      log: drawn?.log ?? false,
      median: drawn?.median ?? 0,
      bound,
    },
    source.kind === "read" ? 150 : 0,
  )

  const select = (next: MetricBound) => {
    setOp(boundKind(next))
    setA(String(next.min ?? next.max))
    setB(String(next.max ?? ""))
  }

  const count = (() => {
    if (!bound) return null
    if (source.kind === "read") return source.count?.(bound) ?? null
    const values = source.values
    if (bound.none)
      return ` · ${((source.total ?? values.length) - values.length).toLocaleString()} with no value`
    const kept = values.filter((v) => inBound(v, bound)).length
    return ` · ${kept.toLocaleString()} of ${values.length.toLocaleString()}`
  })()

  const noValueCount =
    source.kind === "values"
      ? source.total !== undefined
        ? source.total - source.values.length
        : undefined
      : drawn?.noValue

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
            aria-label="Back to the conditions"
            onClick={onBack}
            className="text-app-ink/50 hover:text-app-ink"
          >
            ←
          </button>
        )}
        {label}
        {unit && <span className="font-normal text-app-ink/50">{unit}</span>}
      </div>
      {description && (
        <p className="text-[11px] text-app-ink/50">{description}</p>
      )}
      {drawn === undefined ? (
        <p className="h-16 text-[11px] text-app-ink/50">Loading the spread…</p>
      ) : drawn === null ? (
        <p className="text-[11px] text-app-ink/50">
          Nothing here has a value yet.
        </p>
      ) : (
        <OneSpread
          bars={drawn.bars}
          whole={[drawn.lo, drawn.hi]}
          shown={zoom.range ?? [drawn.lo, drawn.hi]}
          median={drawn.median}
          log={drawn.log}
          selected={bound && !bound.none ? bound : null}
          onPick={(p) => select(pickBound(p, drawn.lo))}
          format={(v) => formatCount(nice(v))}
          noun={noun}
          zoom={kit}
          title={typeof label === "string" ? label : "Spread"}
          testId="number-bound"
        />
      )}
      <BoundFields
        op={op}
        setOp={setOp}
        a={a}
        setA={setA}
        b={b}
        setB={setB}
        min={min}
        noValue={noValue}
      />
      {noValue && (
        <p className="text-[11px] text-app-ink/50">
          {noValueCount
            ? `${noValueCount.toLocaleString()} have no value and fail every bound.`
            : "Anything with no value fails every bound."}{" "}
          No value finds exactly those, and NOT on it the ones that have one.
        </p>
      )}
      <TgButton
        type="submit"
        size="sm"
        disabled={!bound}
        data-testid="number-bound-submit"
        className="w-full"
      >
        {initial ? "Update" : "Add"}
        {count}
      </TgButton>
    </form>
  )
}
