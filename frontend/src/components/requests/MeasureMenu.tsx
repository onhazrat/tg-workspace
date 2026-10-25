import { ChevronDown, Gauge, SlidersHorizontal } from "lucide-react"
import { useState } from "react"
import {
  BarHeading,
  BarPopover,
  BarSearch,
  MenuRowLabel,
} from "@/components/BarPopover"
import { NumberBoundEditor } from "@/components/filter-tree/NumberBoundEditor"
import { pillClass } from "@/components/PostFilterParts"
import { boundText, type MetricBound } from "@/lib/channels/channel-metrics"
import type { Measure } from "@/lib/requests/breakdown"
import {
  type ChannelCond,
  type CriteriaGroup,
  type MeasureCond,
  measureLabel,
  measureMeta,
} from "@/lib/requests/channel-filter"

/** A measure's values across the rows, ascending, for its Spread. */
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
        <MeasureNumberEditor
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

/**
 * One measure's bound over the Channel rows: the one Number bound editor,
 * never below zero, and with no No value, as every row has the number.
 */
export function MeasureNumberEditor({
  measure,
  kind,
  values,
  ...rest
}: {
  measure: Measure
  kind?: string
  values: number[]
  initial?: MetricBound
  onSubmit: (bound: MetricBound) => void
  onBack?: () => void
}) {
  return (
    <NumberBoundEditor
      label={measureLabel(measure, kind)}
      unit={measureMeta(measure).unit}
      source={{ kind: "values", values }}
      min={0}
      noValue={false}
      noun="channels"
      {...rest}
    />
  )
}
