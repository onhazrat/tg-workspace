import { ChevronDown, Gauge, SlidersHorizontal } from "lucide-react"
import { useState } from "react"
import {
  BarHeading,
  BarPopover,
  BarSearch,
  MenuRowLabel,
} from "@/components/BarPopover"
import { histogram } from "@/components/channel-grid/ChannelMetricEditor"
import { BoundHistogram, nice } from "@/components/filter-tree/BarHistogram"
import { BoundFields } from "@/components/filter-tree/BoundFields"
import { pillClass } from "@/components/PostFilterParts"
import { useZoomState } from "@/components/SpreadZoom"
import { NumberBoundEditor } from "@/components/spread-prototype/NumberBoundEditor"
import { useSpreadVariant } from "@/components/spread-prototype/variant"
import { TgButton } from "@/components/ui/tg-button"
import {
  type BoundKind,
  boundKind,
  boundText,
  inBound,
  type MetricBound,
  parseBound,
} from "@/lib/channels/channel-metrics"
import type { Measure } from "@/lib/requests/breakdown"
import {
  type ChannelCond,
  type CriteriaGroup,
  type MeasureCond,
  measureLabel,
  measureMeta,
} from "@/lib/requests/channel-filter"

/** A measure's values across the rows, ascending, for its histogram. */
export type MeasureValues = (m: Measure, kind?: string) => number[]

/**
 * The Filters dropdown (RQS-04): every measure, whole-row and per kind, with
 * a search over them; picking one opens its editor, as on the Channels tab.
 */
export function MeasureMenu({
  conditions,
  groups,
  values,
  onAdd,
}: {
  /** The measure Conditions anywhere in the filter, shown beside their rows. */
  conditions: { not: boolean; cond: MeasureCond }[]
  groups: CriteriaGroup[]
  values: MeasureValues
  onAdd: (cond: ChannelCond) => void
}) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<{ measure: Measure; kind?: string }>()
  const [query, setQuery] = useState("")
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setPicked(undefined)
      setQuery("")
    }
  }
  return (
    <BarPopover
      open={open}
      onOpenChange={onOpenChange}
      trigger={
        <button
          type="button"
          data-testid="requests-filters"
          className={pillClass(conditions.length > 0)}
        >
          <SlidersHorizontal size={12} /> Filters
          {conditions.length > 0 && (
            <span className="rounded-full bg-app-bg/20 px-1.5 text-[10px] tabular-nums">
              {conditions.length}
            </span>
          )}
          <ChevronDown size={12} className="opacity-60" />
        </button>
      }
    >
      {picked ? (
        <MeasureEditor
          measure={picked.measure}
          kind={picked.kind}
          values={values(picked.measure, picked.kind)}
          onBack={() => setPicked(undefined)}
          onSubmit={(bound) => {
            onAdd({ type: "measure", ...picked, bound })
            onOpenChange(false)
          }}
        />
      ) : (
        <div className="max-h-[60vh] space-y-0.5 overflow-y-auto text-xs">
          <BarSearch
            value={query}
            onChange={setQuery}
            placeholder="Search criteria..."
          />
          {groups.map((g) => (
            <CriteriaRows
              key={g.heading}
              group={g}
              query={query}
              conditions={conditions}
              onPick={(measure) => setPicked({ measure, kind: g.kind })}
            />
          ))}
        </div>
      )}
    </BarPopover>
  )
}

/** One group's measures the search keeps: "auto fail" finds Auto sync · Failed syncs. */
function CriteriaRows({
  group,
  query,
  conditions,
  onPick,
}: {
  group: CriteriaGroup
  query: string
  conditions: { not: boolean; cond: MeasureCond }[]
  onPick: (m: Measure) => void
}) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const rows = group.measures.filter((m) => {
    const text = measureLabel(m, group.kind).toLowerCase()
    return words.every((w) => text.includes(w))
  })
  if (!rows.length) return null
  const applied = (m: Measure) =>
    conditions
      .filter((c) => c.cond.measure === m && c.cond.kind === group.kind)
      .map(
        (c) =>
          `${c.not ? "not " : ""}${boundText(c.cond.bound)}${measureMeta(m).unit ?? ""}`,
      )
      .join(", ")
  return (
    <div>
      <BarHeading>{group.heading}</BarHeading>
      {rows.map((m) => (
        <button
          key={m}
          type="button"
          data-testid={`requests-filters-${group.kind ?? "row"}-${m}`}
          onClick={() => onPick(m)}
          className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left font-semibold hover:bg-app-ink/5"
        >
          <MenuRowLabel icon={Gauge} label={measureMeta(m).label} />
          <span className="text-[11px] font-normal tabular-nums text-app-ink/50">
            {applied(m)}
          </span>
        </button>
      ))}
    </div>
  )
}

const median = (sorted: number[]) => sorted[Math.floor(sorted.length / 2)]

/** One measure's bound over the Channel rows: the Channels tab's histogram and fields. */
// PROTOTYPE: variant 1 draws the one Number bound editor.
export function MeasureEditor(props: {
  measure: Measure
  kind?: string
  values: number[]
  initial?: MetricBound
  onSubmit: (bound: MetricBound) => void
  onBack?: () => void
}) {
  if (useSpreadVariant() !== "1") return <MeasureEditor0 {...props} />
  return (
    <NumberBoundEditor
      label={measureLabel(props.measure, props.kind)}
      unit={measureMeta(props.measure).unit}
      initial={props.initial}
      source={{ kind: "values", values: props.values }}
      min={0}
      noValue={false}
      noun="channels"
      onSubmit={props.onSubmit}
      onBack={props.onBack}
    />
  )
}

function MeasureEditor0({
  measure,
  kind,
  values,
  initial,
  onSubmit,
  onBack,
}: {
  measure: Measure
  kind?: string
  values: number[]
  initial?: MetricBound
  onSubmit: (bound: MetricBound) => void
  onBack?: () => void
}) {
  const [op, setOp] = useState<BoundKind>(boundKind(initial))
  const [a, setA] = useState(() => {
    const start = op === "lte" ? initial?.max : initial?.min
    return String(start ?? (values.length ? nice(median(values)) : ""))
  })
  const [b, setB] = useState(String(initial?.max ?? ""))
  const bound = parseBound(op, a, b, { min: 0 })
  const zoom = useZoomState()
  const kept = bound ? values.filter((v) => inBound(v, bound)).length : 0
  const unit = measureMeta(measure).unit
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
        {measureLabel(measure, kind)}
        {unit && <span className="font-normal text-app-ink/50">{unit}</span>}
      </div>
      {values.length > 0 && (
        <BoundHistogram
          distribution={histogram(values, zoom.range)}
          bound={bound}
          noun="channels"
          onSelect={(next) => {
            setOp(boundKind(next))
            setA(String(next.min ?? next.max))
            setB(String(next.max ?? ""))
          }}
          zoom={zoom}
        />
      )}
      <BoundFields
        op={op}
        setOp={setOp}
        a={a}
        setA={setA}
        b={b}
        setB={setB}
        min={0}
        noValue={false}
      />
      <TgButton
        type="submit"
        size="sm"
        disabled={!bound}
        data-testid="requests-measure-submit"
        className="w-full"
      >
        {initial ? "Update" : "Add"} · {kept} of {values.length} with this
        number
      </TgButton>
    </form>
  )
}
