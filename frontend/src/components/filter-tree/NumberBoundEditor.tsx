/**
 * The one Number bound editor (ADR-037): the Channel filter's, the
 * Directory filter's, the Post filter's and the Requests channel table's.
 * The number's name and Spread, the operator and its fields, the no-value
 * note, and Add with what the bound keeps. Each caller is an adapter
 * passing a source and three switches; what the fields spell is
 * `channel-metrics.ts::parseBound`'s to read.
 */
import { type ReactNode, useMemo, useState } from "react"
import { Spread } from "@/components/Spread"
import {
  SETTLE_MS,
  useRangeZoomKit,
  useZoomState,
  type ZoomState,
} from "@/components/SpreadZoom"
import { TgButton } from "@/components/ui/tg-button"
import {
  type BoundKind,
  boundKind,
  inBound,
  type MetricBound,
  parseBound,
  wholeBound,
} from "@/lib/channels/channel-metrics"
import { formatCount } from "@/lib/format-count"
import {
  binSpread,
  median,
  nice,
  pickBound,
  type SpreadBar,
} from "@/lib/spread"

/** A number's bars, and the whole spread's ends, median and scale. */
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
 * Where the numbers come from: local values, sorted, that the editor bins,
 * zooms and counts itself, out of `total` where some have no value; or a
 * read the caller makes for the zoom it is given, with an optional count of
 * what a bound keeps.
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

const OPS: [BoundKind, string][] = [
  ["gte", "at least"],
  ["lte", "at most"],
  ["between", "between"],
  ["none", "no value"],
]

const noteClass = "text-[11px] text-app-ink/50"
const fieldClass =
  "h-8 min-w-0 flex-1 rounded-md border border-app-ink/15 bg-app-muted px-2 text-xs tabular-nums outline-none focus:border-app-ink/40"

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
  label: string
  unit?: string
  description?: ReactNode
  /** The Condition being changed; without one the editor adds. */
  initial?: MetricBound
  source: NumberSource
  /** The floor: a field under it is refused (a count is never negative). */
  min?: number
  /** A whole number: the bound is rounded inward. */
  whole?: boolean
  /** Whether No value is offered; a number that always has one has none. */
  noValue?: boolean
  /** What the bars count, plural: "channels", "posts". */
  noun: string
  onSubmit: (bound: MetricBound) => void
  onBack?: () => void
}) {
  const own = useZoomState()
  const zoom = source.kind === "values" ? own : source.zoom
  const local = source.kind === "values" ? source.values : null
  const binned = useMemo(
    () => (local?.length ? binSpread(local, own.range) : null),
    [local, own.range],
  )
  const drawn = source.kind === "values" ? binned : source.read

  // The median prefills only when the bars are known as the editor opens,
  // which a read's are not, so the field never jumps once a read lands.
  const [op, setOp] = useState<BoundKind>(boundKind(initial))
  const [a, setA] = useState(() => {
    const start = op === "lte" ? initial?.max : initial?.min
    return String(start ?? (local?.length ? nice(median(local)) : ""))
  })
  const [b, setB] = useState(String(initial?.max ?? ""))
  const typed = parseBound(op, a, b, { min })
  const bound = whole && typed && !typed.none ? wholeBound(typed) : typed

  const kit = useRangeZoomKit(
    zoom,
    {
      lo: drawn?.lo ?? 0,
      hi: drawn?.hi ?? 0,
      log: drawn?.log ?? false,
      median: drawn?.median ?? 0,
      bound,
    },
    source.kind === "read" ? SETTLE_MS : 0,
  )
  const select = (next: MetricBound) => {
    setOp(boundKind(next))
    setA(String(next.min ?? next.max))
    setB(String(next.max ?? ""))
  }

  const noValueCount =
    source.kind === "read"
      ? source.read?.noValue
      : source.total === undefined
        ? undefined
        : source.total - source.values.length
  const count = !bound
    ? null
    : !local
      ? source.kind === "read" && source.count?.(bound)
      : bound.none
        ? noValueCount !== undefined &&
          ` · ${noValueCount.toLocaleString()} with no value`
        : ` · ${local.filter((v) => inBound(v, bound)).length.toLocaleString()} of ${local.length.toLocaleString()}`

  const field = (name: string, value: string, set: (t: string) => void) => (
    <input
      type="number"
      min={min}
      step="any"
      aria-label={name}
      value={value}
      onChange={(e) => set(e.target.value)}
      className={fieldClass}
    />
  )

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
      {description && <p className={noteClass}>{description}</p>}
      {drawn === undefined ? (
        <p className={`h-16 ${noteClass}`}>Loading the spread…</p>
      ) : drawn === null ? (
        <p className={noteClass}>Nothing has a value yet.</p>
      ) : (
        <Spread
          bars={drawn.bars}
          whole={[drawn.lo, drawn.hi]}
          shown={zoom.range ?? [drawn.lo, drawn.hi]}
          median={drawn.median}
          log={drawn.log}
          selected={bound && !bound.none ? bound : null}
          onPick={(p) => select(pickBound(p, drawn.lo))}
          format={formatCount}
          noun={noun}
          zoom={kit}
          title={label}
        />
      )}
      <fieldset aria-label="Operator" className="m-0 flex gap-1 border-0 p-0">
        {OPS.filter(([key]) => noValue || key !== "none").map(([key, text]) => (
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
            {text}
          </button>
        ))}
      </fieldset>
      {op !== "none" && (
        <div className="flex items-center gap-1.5">
          {field(op === "between" ? "From" : "Value", a, setA)}
          {op === "between" && (
            <>
              <span className="text-app-ink/50">and</span>
              {field("To", b, setB)}
            </>
          )}
        </div>
      )}
      {noValue && (
        <p className={noteClass}>
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
